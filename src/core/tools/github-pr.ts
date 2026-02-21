import type { ToolDefinition, ToolResult } from './types.js';
import { GitHubClient, type GitHubConfig } from '../integrations/github-client.js';

let githubClient: GitHubClient | null = null;

export function setGitHubConfig(config: GitHubConfig): void {
  githubClient = new GitHubClient(config);
}

export function isGitHubConfigured(): boolean {
  return githubClient !== null;
}

// Auto-initialize with default config (gh CLI auth)
githubClient = new GitHubClient();

export const githubTool: ToolDefinition = {
  name: 'github',
  description: `Interact with GitHub for PR management. Actions:
- createBranch: Create a feature branch. Params: { name: "feature/PROJ-123", base?: "main" }
- createPR: Create a pull request. Params: { title: "...", body: "...", head: "feature/PROJ-123", base?: "main" }
- getPR: Get PR details by number. Params: { number: 42 }
- listPRs: List pull requests. Params: { state?: "open"|"closed"|"all" }
- addComment: Comment on a PR. Params: { number: 42, comment: "LGTM!" }`,
  category: 'execute',
  parameters: {
    type: 'object',
    properties: {
      action: {
        type: 'string',
        description: 'The GitHub action to perform',
        enum: ['createBranch', 'createPR', 'getPR', 'listPRs', 'addComment'],
      },
      params: {
        type: 'string',
        description: 'JSON string of action parameters',
      },
    },
    required: ['action'],
  },
};

export function executeGitHub(args: Record<string, unknown>, cwd: string): ToolResult {
  const start = Date.now();
  const action = args.action as string;

  if (!githubClient) {
    return {
      name: 'github',
      success: false,
      output: 'GitHub not configured. Ensure `gh` CLI is installed and authenticated.',
      duration: Date.now() - start,
    };
  }

  let params: Record<string, unknown> = {};
  if (args.params) {
    try {
      params = typeof args.params === 'string' ? JSON.parse(args.params) : args.params as Record<string, unknown>;
    } catch {
      return { name: 'github', success: false, output: 'Invalid params JSON.', duration: Date.now() - start };
    }
  }

  try {
    switch (action) {
      case 'createBranch': {
        if (!params.name) return fail('createBranch requires name', start);
        const base = (params.base as string) || 'main';
        const branch = githubClient.createBranch(params.name as string, base, cwd);
        return ok(`Created and checked out branch: ${branch}`, start);
      }
      case 'createPR': {
        if (!params.title || !params.head) return fail('createPR requires title and head', start);
        const pr = githubClient.createPR({
          title: params.title as string,
          body: (params.body as string) || '',
          head: params.head as string,
          base: (params.base as string) || 'main',
          cwd,
        });
        return ok(JSON.stringify(pr, null, 2), start);
      }
      case 'getPR': {
        if (!params.number) return fail('getPR requires number', start);
        const pr = githubClient.getPR(params.number as number, cwd);
        return ok(JSON.stringify(pr, null, 2), start);
      }
      case 'listPRs': {
        const state = (params.state as string) || 'open';
        const prs = githubClient.listPRs(state, cwd);
        return ok(JSON.stringify(prs, null, 2), start);
      }
      case 'addComment': {
        if (!params.number || !params.comment) return fail('addComment requires number and comment', start);
        githubClient.addComment(params.number as number, params.comment as string, cwd);
        return ok(`Comment added to PR #${params.number}`, start);
      }
      default:
        return fail(`Unknown github action: ${action}`, start);
    }
  } catch (err) {
    return {
      name: 'github',
      success: false,
      output: `GitHub action failed: ${err instanceof Error ? err.message : 'Unknown error'}`,
      duration: Date.now() - start,
    };
  }
}

function ok(output: string, start: number): ToolResult {
  return { name: 'github', success: true, output, duration: Date.now() - start };
}

function fail(message: string, start: number): ToolResult {
  return { name: 'github', success: false, output: message, duration: Date.now() - start };
}
