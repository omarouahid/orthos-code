import { execSync } from 'node:child_process';
import type { ToolDefinition, ToolResult } from './types.js';

export const bashTool: ToolDefinition = {
  name: 'bash',
  description: 'Execute a shell command and return the output. Use for running scripts, git commands, npm, etc.',
  category: 'execute',
  parameters: {
    type: 'object',
    properties: {
      command: { type: 'string', description: 'The shell command to execute' },
      timeout: { type: 'number', description: 'Timeout in milliseconds (default 30000)' },
    },
    required: ['command'],
  },
};

export function executeBash(args: Record<string, unknown>, cwd: string): ToolResult {
  const start = Date.now();
  const command = String(args.command);
  const timeout = args.timeout ? Number(args.timeout) : 30000;

  try {
    const output = execSync(command, {
      cwd,
      encoding: 'utf-8',
      timeout,
      maxBuffer: 1024 * 1024, // 1MB
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    return {
      name: 'bash',
      success: true,
      output: output.trim() || '(no output)',
      duration: Date.now() - start,
    };
  } catch (err: any) {
    const stderr = err.stderr?.toString() || '';
    const stdout = err.stdout?.toString() || '';
    const combined = (stdout + '\n' + stderr).trim();

    // Classify the error for better feedback
    let prefix: string;
    if (err.killed || err.signal === 'SIGTERM') {
      prefix = `Command timed out after ${timeout}ms`;
    } else if (err.code === 'ENOENT') {
      prefix = `Command not found: ${command.split(/\s+/)[0]}`;
    } else if (err.code === 'EACCES') {
      prefix = `Permission denied`;
    } else {
      prefix = `Exit code ${err.status || 1}`;
    }

    return {
      name: 'bash',
      success: false,
      output: `${prefix}:\n${combined || err.message || 'Command failed'}`,
      duration: Date.now() - start,
    };
  }
}
