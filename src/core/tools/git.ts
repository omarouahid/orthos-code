import { execSync, execFileSync } from 'node:child_process';
import type { ToolDefinition, ToolResult } from './types.js';

export const gitStatusTool: ToolDefinition = {
  name: 'git_status',
  description: 'Show the git status of the current repository (modified, staged, untracked files).',
  category: 'git',
  parameters: {
    type: 'object',
    properties: {},
    required: [],
  },
};

export const gitDiffTool: ToolDefinition = {
  name: 'git_diff',
  description: 'Show git diff of changes. Optionally diff a specific file or staged changes.',
  category: 'git',
  parameters: {
    type: 'object',
    properties: {
      path: { type: 'string', description: 'Optional file path to diff' },
      staged: { type: 'string', description: 'Set to "true" to show staged changes' },
    },
    required: [],
  },
};

export const gitCommitTool: ToolDefinition = {
  name: 'git_commit',
  description: 'Stage files and create a git commit with a message.',
  category: 'git',
  parameters: {
    type: 'object',
    properties: {
      message: { type: 'string', description: 'Commit message' },
      files: { type: 'string', description: 'Space-separated file paths to stage (use "." for all)' },
    },
    required: ['message'],
  },
};

export const gitLogTool: ToolDefinition = {
  name: 'git_log',
  description: 'Show recent git commit log.',
  category: 'git',
  parameters: {
    type: 'object',
    properties: {
      count: { type: 'number', description: 'Number of commits to show (default 10)' },
    },
    required: [],
  },
};

function runGit(command: string, cwd: string): ToolResult {
  const start = Date.now();
  const name = command.split(' ')[0] === 'git' ? `git_${command.split(' ')[1]}` : 'git';

  try {
    const output = execSync(command, {
      cwd,
      encoding: 'utf-8',
      timeout: 15000,
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    return { name, success: true, output: output.trim() || '(no output)', duration: Date.now() - start };
  } catch (err: any) {
    const msg = err.stderr?.toString() || err.message || 'Git command failed';
    return { name, success: false, output: msg.trim(), duration: Date.now() - start };
  }
}

export function executeGitStatus(_args: Record<string, unknown>, cwd: string): ToolResult {
  return runGit('git status --short --branch', cwd);
}

export function executeGitDiff(args: Record<string, unknown>, cwd: string): ToolResult {
  let cmd = 'git diff';
  if (args.staged === 'true') cmd += ' --staged';
  if (args.path) cmd += ` -- "${String(args.path)}"`;
  return runGit(cmd, cwd);
}

export function executeGitCommit(args: Record<string, unknown>, cwd: string): ToolResult {
  const start = Date.now();
  const message = String(args.message);
  const files = args.files ? String(args.files).split(/\s+/) : ['.'];

  try {
    // Use execFileSync with arg arrays to prevent command injection
    execFileSync('git', ['add', ...files], { cwd, encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'] });
    const output = execFileSync('git', ['commit', '-m', message], {
      cwd, encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'],
    });
    return { name: 'git_commit', success: true, output: output.trim(), duration: Date.now() - start };
  } catch (err: any) {
    const msg = err.stderr?.toString() || err.stdout?.toString() || err.message;
    return { name: 'git_commit', success: false, output: msg.trim(), duration: Date.now() - start };
  }
}

export function executeGitLog(args: Record<string, unknown>, cwd: string): ToolResult {
  const count = args.count ? Number(args.count) : 10;
  return runGit(`git log --oneline --graph -${count}`, cwd);
}
