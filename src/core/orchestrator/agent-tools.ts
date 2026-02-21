import { ALL_TOOLS } from '../tools/index.js';
import type { ToolDefinition } from '../tools/types.js';
import type { AgentRole } from './types.js';
import { browserTool } from '../tools/browser.js';
import { jiraTool, isJiraConfigured } from '../tools/jira.js';
import { githubTool } from '../tools/github-pr.js';

/** Tools available per agent role */
const ROLE_TOOL_NAMES: Record<AgentRole, string[]> = {
  coder: [
    'read_file', 'write_file', 'edit_file', 'bash',
    'grep', 'glob', 'git_status', 'git_diff',
    'browser', 'jira', 'github',
  ],
  researcher: [
    'read_file', 'grep', 'glob', 'web_search',
    'git_log', 'git_status', 'git_diff',
  ],
  reviewer: [
    'read_file', 'grep', 'glob',
    'git_status', 'git_diff', 'git_log', 'bash',
  ],
};

/** Conditional tools that aren't in ALL_TOOLS but may be needed by agents */
const CONDITIONAL_TOOLS: Record<string, () => ToolDefinition | null> = {
  browser: () => browserTool,
  jira: () => isJiraConfigured() ? jiraTool : null,
  github: () => githubTool,
};

/** Get the filtered tool definitions for a given role. */
export function getToolsForRole(role: AgentRole): ToolDefinition[] {
  const allowed = new Set(ROLE_TOOL_NAMES[role]);
  const tools = ALL_TOOLS.filter((t) => allowed.has(t.name));

  // Add conditional tools that are in the role's allowed list
  for (const [name, getTool] of Object.entries(CONDITIONAL_TOOLS)) {
    if (allowed.has(name) && !tools.some((t) => t.name === name)) {
      const tool = getTool();
      if (tool) tools.push(tool);
    }
  }

  return tools;
}

/** Check if a tool name is allowed for a given role. */
export function isToolAllowedForRole(role: AgentRole, toolName: string): boolean {
  return ROLE_TOOL_NAMES[role].includes(toolName);
}
