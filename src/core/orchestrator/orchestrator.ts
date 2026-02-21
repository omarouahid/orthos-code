import { EventEmitter } from 'events';
import type { AppConfig } from '../../types/index.js';
import type { LLMProvider } from '../providers/types.js';
import type { ToolDefinition, ToolResult } from '../tools/types.js';
import type { AgentRole, AgentTask, ExecutionMode, OrchestrationSession } from './types.js';
import { runSubAgent, clearAllLocks } from './sub-agent.js';

export const orchestratorEvents = new EventEmitter();
orchestratorEvents.setMaxListeners(20);

let currentSession: OrchestrationSession | null = null;

export function getOrchestrationSession(): OrchestrationSession | null {
  return currentSession;
}

export function clearOrchestrationSession(): void {
  currentSession = null;
  clearAllLocks();
}

export function startOrchestrationSession(
  executionMode: ExecutionMode,
  coderModel?: string,
): OrchestrationSession {
  currentSession = {
    active: true,
    executionMode,
    tasks: [],
    coderModel,
  };
  return currentSession;
}

/**
 * The delegate_to_agent tool definition.
 * Added to the tool list when agent mode is active.
 */
export const delegateToAgentTool: ToolDefinition = {
  name: 'delegate_to_agent',
  description: `Delegate a task to a specialized sub-agent. Available roles:
- "coder": Writes/edits code. Has read_file, write_file, edit_file, bash, grep, glob, git_status, git_diff.
- "researcher": Explores codebase and web. Has read_file, grep, glob, web_search, git tools. READ-ONLY.
- "reviewer": Validates changes and quality. Has read_file, grep, glob, git tools, bash. Can run tests.

Each agent runs independently with its own conversation and returns a summary.
Be very specific in your task descriptions — agents have no context beyond what you provide.`,
  category: 'execute',
  parameters: {
    type: 'object',
    properties: {
      role: {
        type: 'string',
        description: 'The agent role: "coder", "researcher", or "reviewer"',
        enum: ['coder', 'researcher', 'reviewer'],
      },
      task: {
        type: 'string',
        description: 'Detailed description of what the agent should do. Include file paths, patterns, and expected outcomes.',
      },
      step_id: {
        type: 'string',
        description: 'The plan step ID (1-based) this agent is working on. Used for progress tracking.',
      },
    },
    required: ['role', 'task'],
  },
};

// --- Delegation execution ---

export interface ExecuteDelegationOptions {
  role: AgentRole;
  taskDescription: string;
  stepId: number;
  provider: LLMProvider;
  model: string;
  config: AppConfig;
  cwd: string;
  projectContext: string;
  abortSignal?: AbortSignal;
  onPermissionNeeded?: (
    toolName: string,
    toolArgs: Record<string, unknown>,
  ) => Promise<{ approved: boolean; note?: string }>;
  onChunk?: (chunk: string) => void;
}

export async function executeDelegation(options: ExecuteDelegationOptions): Promise<ToolResult> {
  const start = Date.now();
  const taskId = `agent-${options.role}-${options.stepId}-${Date.now()}`;

  const task: AgentTask = {
    id: taskId,
    role: options.role,
    stepId: options.stepId,
    description: options.taskDescription,
    status: 'running',
    startedAt: Date.now(),
  };

  if (currentSession) {
    currentSession.tasks.push(task);
  }

  orchestratorEvents.emit('agentStarted', task);

  try {
    const result = await runSubAgent({
      task,
      provider: options.provider,
      model: options.model,
      cwd: options.cwd,
      projectContext: options.projectContext,
      providerType: options.config.provider,
      abortSignal: options.abortSignal,
      onPermissionNeeded: options.onPermissionNeeded,
      onChunk: options.onChunk,
      ollamaTimeout: options.config.ollamaTimeout,
    });

    task.status = 'completed';
    task.result = result;
    task.completedAt = Date.now();
    orchestratorEvents.emit('agentCompleted', task);

    return {
      name: 'delegate_to_agent',
      success: true,
      output: `[${options.role.toUpperCase()} AGENT — Step ${options.stepId}] Completed in ${((Date.now() - start) / 1000).toFixed(1)}s.\n\n${result}`,
      duration: Date.now() - start,
    };
  } catch (err) {
    task.status = 'failed';
    task.completedAt = Date.now();
    task.result = err instanceof Error ? err.message : 'Unknown error';
    orchestratorEvents.emit('agentFailed', task);

    return {
      name: 'delegate_to_agent',
      success: false,
      output: `[${options.role.toUpperCase()} AGENT — Step ${options.stepId}] Failed: ${task.result}`,
      duration: Date.now() - start,
    };
  }
}

export async function executeParallelDelegations(
  delegations: ExecuteDelegationOptions[],
): Promise<ToolResult[]> {
  const results = await Promise.allSettled(
    delegations.map((d) => executeDelegation(d)),
  );

  return results.map((r, i) => {
    if (r.status === 'fulfilled') return r.value;
    return {
      name: 'delegate_to_agent',
      success: false,
      output: `[${delegations[i].role.toUpperCase()} AGENT] Failed: ${r.reason?.message || 'Unknown error'}`,
      duration: 0,
    };
  });
}
