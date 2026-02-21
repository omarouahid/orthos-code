import { EventEmitter } from 'events';
import type { Message, StreamResult } from '../../types/index.js';
import type { LLMProvider } from '../providers/types.js';
import type { ToolResult } from '../tools/types.js';
import type { AgentTask, AgentProgressEvent } from './types.js';
import { executeTool, formatToolCall } from '../tools/index.js';
import { getToolsForRole, isToolAllowedForRole } from './agent-tools.js';
import { buildAgentSystemPrompt } from './agent-prompts.js';
import { checkPermission } from '../permissions.js';

export const agentEvents = new EventEmitter();
agentEvents.setMaxListeners(50);

// --- File lock manager for parallel execution safety ---

const fileLocks = new Map<string, string>(); // filepath -> agentTaskId

export function acquireFileLock(filepath: string, taskId: string): boolean {
  const existing = fileLocks.get(filepath);
  if (existing && existing !== taskId) return false;
  fileLocks.set(filepath, taskId);
  return true;
}

export function releaseFileLocks(taskId: string): void {
  for (const [path, holder] of fileLocks.entries()) {
    if (holder === taskId) fileLocks.delete(path);
  }
}

export function clearAllLocks(): void {
  fileLocks.clear();
}

// --- Sub-agent runner ---

export interface SubAgentRunOptions {
  task: AgentTask;
  provider: LLMProvider;
  model: string;
  cwd: string;
  projectContext: string;
  providerType: 'ollama' | 'anthropic' | 'openrouter' | 'deepseek';
  abortSignal?: AbortSignal;
  onPermissionNeeded?: (
    toolName: string,
    toolArgs: Record<string, unknown>,
  ) => Promise<{ approved: boolean; note?: string }>;
  onChunk?: (chunk: string) => void;
  ollamaTimeout?: number;
}

/**
 * Run a sub-agent to completion. Each sub-agent gets a fresh conversation
 * context with a role-specific system prompt and filtered tools.
 * Returns the agent's final text output.
 */
export async function runSubAgent(options: SubAgentRunOptions): Promise<string> {
  const {
    task, provider, model, cwd, projectContext,
    providerType, abortSignal, onPermissionNeeded, onChunk, ollamaTimeout,
  } = options;

  const tools = getToolsForRole(task.role);
  const systemPrompt = buildAgentSystemPrompt(
    task.role, cwd, projectContext, providerType, task.description,
  );

  // Fresh conversation — only the task description
  const messages: Message[] = [{
    id: `${task.id}-init`,
    role: 'user',
    content: task.description,
    timestamp: Date.now(),
  }];

  const MAX_ITERATIONS = 50;
  let iteration = 0;
  let finalContent = '';

  const emitProgress = (detail?: string) => {
    const event: AgentProgressEvent = {
      taskId: task.id,
      role: task.role,
      status: task.status,
      stepId: task.stepId,
      detail,
    };
    agentEvents.emit('agentProgress', event);
  };

  emitProgress('Starting...');

  while (iteration < MAX_ITERATIONS) {
    iteration++;

    if (abortSignal?.aborted) {
      throw new Error('Agent aborted');
    }

    const result: StreamResult = await provider.streamChat(
      model,
      messages,
      systemPrompt,
      (chunk) => { onChunk?.(chunk); },
      abortSignal,
      ollamaTimeout,
      tools,
    );

    // No tool calls → agent is done
    if (!result.toolCalls || result.toolCalls.length === 0) {
      finalContent = result.content;
      messages.push({
        id: `${task.id}-resp-${iteration}`,
        role: 'assistant',
        content: result.content,
        timestamp: Date.now(),
      });
      break;
    }

    // Process tool calls
    const toolResults: ToolResult[] = [];

    for (const tc of result.toolCalls) {
      // Verify tool is allowed for this role
      if (!isToolAllowedForRole(task.role, tc.name)) {
        toolResults.push({
          name: tc.name,
          success: false,
          output: `Tool ${tc.name} is not available for ${task.role} agents.`,
          duration: 0,
        });
        continue;
      }

      emitProgress(formatToolCall(tc.name, tc.arguments));

      // File locking for write operations
      if (tc.name === 'write_file' || tc.name === 'edit_file') {
        const filepath = tc.arguments.path as string;
        if (filepath && !acquireFileLock(filepath, task.id)) {
          toolResults.push({
            name: tc.name,
            success: false,
            output: `File ${filepath} is locked by another agent. Skipping to avoid conflicts.`,
            duration: 0,
          });
          continue;
        }
      }

      // Permission check (respects YOLO mode)
      const permission = checkPermission(tc.name);
      if (permission === 'denied') {
        toolResults.push({
          name: tc.name, success: false, output: 'Permission denied.', duration: 0,
        });
        continue;
      }
      if (permission === 'needs_approval' && onPermissionNeeded) {
        const { approved } = await onPermissionNeeded(tc.name, tc.arguments);
        if (!approved) {
          toolResults.push({
            name: tc.name, success: false, output: 'User denied permission.', duration: 0,
          });
          continue;
        }
      }

      // Execute
      const toolResult = executeTool(tc.name, tc.arguments, cwd);
      toolResults.push(toolResult);
    }

    // Add assistant message with tool calls
    messages.push({
      id: `${task.id}-asst-${iteration}`,
      role: 'assistant',
      content: result.content,
      timestamp: Date.now(),
      toolCalls: result.toolCalls,
      toolResults,
    });

    // Add tool result messages
    for (let i = 0; i < result.toolCalls.length; i++) {
      messages.push({
        id: `${task.id}-tool-${iteration}-${i}`,
        role: 'tool',
        content: JSON.stringify({
          name: result.toolCalls[i].name,
          result: toolResults[i]?.output || 'No result',
          success: toolResults[i]?.success ?? false,
        }),
        timestamp: Date.now(),
      });
    }
  }

  // Release file locks
  releaseFileLocks(task.id);

  if (!finalContent && iteration >= MAX_ITERATIONS) {
    throw new Error(`Agent ${task.id} (${task.role}) hit max iterations without completing`);
  }

  return finalContent;
}
