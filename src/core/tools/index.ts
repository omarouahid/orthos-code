import type { ToolDefinition, ToolResult, PermissionConfig } from './types.js';
import { readFileTool, executeReadFile } from './read-file.js';
import { writeFileTool, executeWriteFile } from './write-file.js';
import { editFileTool, executeEditFile } from './edit-file.js';
import { bashTool, executeBash } from './bash.js';
import { grepTool, executeGrep } from './grep.js';
import { globTool, executeGlob } from './glob.js';
import {
  gitStatusTool, gitDiffTool, gitCommitTool, gitLogTool,
  executeGitStatus, executeGitDiff, executeGitCommit, executeGitLog,
} from './git.js';
import { webSearchTool, executeWebSearch } from './web-search.js';
import {
  createPlanTool, updatePlanStepTool,
  executeCreatePlan, executeUpdatePlanStep,
} from '../planner.js';
import { delegateToAgentTool } from '../orchestrator/orchestrator.js';
import { browserTool } from './browser.js';
import { jiraTool, executeJira, isJiraConfigured } from './jira.js';
import { githubTool, executeGitHub } from './github-pr.js';

// All available tools (base set — without agent delegation or browser)
export const ALL_TOOLS: ToolDefinition[] = [
  readFileTool,
  writeFileTool,
  editFileTool,
  bashTool,
  grepTool,
  globTool,
  gitStatusTool,
  gitDiffTool,
  gitCommitTool,
  gitLogTool,
  webSearchTool,
  createPlanTool,
  updatePlanStepTool,
];

/** Get active tools — conditionally adds browser, jira, github, delegate_to_agent */
export function getActiveTools(agentMode: boolean, browserConnected: boolean = false): ToolDefinition[] {
  const tools = [...ALL_TOOLS];
  if (browserConnected) tools.push(browserTool);
  if (isJiraConfigured()) tools.push(jiraTool);
  tools.push(githubTool); // Always available (uses gh CLI)
  if (agentMode) tools.push(delegateToAgentTool);
  return tools;
}

// Convert to Ollama tool format
export function getOllamaTools(): object[] {
  return ALL_TOOLS.map((tool) => ({
    type: 'function',
    function: {
      name: tool.name,
      description: tool.description,
      parameters: tool.parameters,
    },
  }));
}

// Execute a tool by name
export function executeTool(name: string, args: Record<string, unknown>, cwd: string): ToolResult {
  switch (name) {
    case 'read_file': return executeReadFile(args, cwd);
    case 'write_file': return executeWriteFile(args, cwd);
    case 'edit_file': return executeEditFile(args, cwd);
    case 'bash': return executeBash(args, cwd);
    case 'grep': return executeGrep(args, cwd);
    case 'glob': return executeGlob(args, cwd);
    case 'git_status': return executeGitStatus(args, cwd);
    case 'git_diff': return executeGitDiff(args, cwd);
    case 'git_commit': return executeGitCommit(args, cwd);
    case 'git_log': return executeGitLog(args, cwd);
    case 'web_search': return executeWebSearch(args, cwd);
    case 'create_plan': return executeCreatePlan(args);
    case 'update_plan_step': return executeUpdatePlanStep(args);
    case 'jira':
      // Handled specially — async execution
      return { name, success: false, output: 'jira tool must be handled by the async executor.', duration: 0 };
    case 'github':
      return executeGitHub(args, cwd);
    case 'browser':
      // Handled specially in app.tsx runToolLoop — async execution via BrowserClient
      return { name, success: false, output: 'browser tool must be handled by the async browser executor.', duration: 0 };
    case 'delegate_to_agent':
      // Handled specially in app.tsx runToolLoop — not executed inline
      return { name, success: false, output: 'delegate_to_agent must be handled by the orchestrator loop.', duration: 0 };
    default:
      return { name, success: false, output: `Unknown tool: ${name}`, duration: 0 };
  }
}

// Get the permission category for a tool
export function getToolCategory(name: string): keyof Omit<PermissionConfig, 'yolo'> {
  if (name === 'delegate_to_agent') return delegateToAgentTool.category;
  if (name === 'browser') return browserTool.category;
  if (name === 'jira') return jiraTool.category;
  if (name === 'github') return githubTool.category;
  const tool = ALL_TOOLS.find((t) => t.name === name);
  return tool?.category || 'execute';
}

// Format tool call for display
export function formatToolCall(name: string, args: Record<string, unknown>): string {
  switch (name) {
    case 'read_file': return `read ${args.path}`;
    case 'write_file': return `write ${args.path}`;
    case 'edit_file': return `edit ${args.path}`;
    case 'bash': return `$ ${args.command}`;
    case 'grep': return `grep "${args.pattern}" ${args.path || '.'}`;
    case 'glob': return `glob ${args.pattern}`;
    case 'git_status': return `git status`;
    case 'git_diff': return `git diff${args.path ? ` ${args.path}` : ''}`;
    case 'git_commit': return `git commit -m "${args.message}"`;
    case 'git_log': return `git log`;
    case 'web_search': return `search "${args.query}"`;
    case 'create_plan': return `plan: ${args.title}`;
    case 'update_plan_step': return `step ${args.step_id} → ${args.status}`;
    case 'browser': {
      const action = String(args.action || '');
      const bparams = args.params ? String(args.params).slice(0, 50) : '';
      return `browser:${action}${bparams ? ` ${bparams}` : ''}${bparams.length >= 50 ? '...' : ''}`;
    }
    case 'jira': return `jira:${args.action}`;
    case 'github': return `github:${args.action}`;

    case 'delegate_to_agent': {
      const desc = String(args.task || '').slice(0, 60);
      return `delegate → ${args.role} agent: ${desc}${desc.length >= 60 ? '...' : ''}`;
    }
    default: return `${name}(${JSON.stringify(args)})`;
  }
}

export { type ToolDefinition, type ToolResult, type ToolCall, type PermissionConfig, DEFAULT_PERMISSIONS } from './types.js';
