import { spawn } from 'node:child_process';
import type { ToolDefinition, ToolResult } from './types.js';

export const bashTool: ToolDefinition = {
  name: 'bash',
  description: 'Execute a shell command and return the output. Use for running scripts, git commands, npm, etc. No timeout by default for heavy tasks.',
  category: 'execute',
  parameters: {
    type: 'object',
    properties: {
      command: { type: 'string', description: 'The shell command to execute' },
      timeout: { type: 'number', description: 'Timeout in ms (0 = no timeout, default 0 for heavy tasks)' },
    },
    required: ['command'],
  },
};

function runShell(): string {
  if (process.platform === 'win32') return 'cmd.exe';
  return process.env.SHELL || '/bin/sh';
}

function shellArgs(cmd: string): string[] {
  if (process.platform === 'win32') return ['/c', cmd];
  return ['-c', cmd];
}

/**
 * Execute a shell command. Uses spawn so Ctrl+C (abort) can kill the child.
 * timeout=0 means no timeout (default); only set timeout when > 0.
 */
export function executeBash(
  args: Record<string, unknown>,
  cwd: string,
  abortSignal?: AbortSignal
): Promise<ToolResult> {
  const start = Date.now();
  const command = String(args.command);
  const timeoutMs = args.timeout != null ? Number(args.timeout) : 0;

  return new Promise((resolve) => {
    const shell = runShell();
    const argsArr = shellArgs(command);
    const child = spawn(shell, argsArr, {
      cwd,
      stdio: ['pipe', 'pipe', 'pipe'],
      windowsHide: true,
    });

    let stdout = '';
    let stderr = '';
    let resolved = false;

    const finish = (success: boolean, output: string, prefix?: string) => {
      if (resolved) return;
      resolved = true;
      if (timeoutId != null) clearTimeout(timeoutId);
      resolve({
        name: 'bash',
        success,
        output: prefix ? `${prefix}\n${output}`.trim() : output.trim() || (success ? '(no output)' : 'Command failed'),
        duration: Date.now() - start,
      });
    };

    let timeoutId: ReturnType<typeof setTimeout> | undefined;
    if (timeoutMs > 0) {
      timeoutId = setTimeout(() => {
        if (!resolved) {
          resolved = true;
          if (timeoutId != null) clearTimeout(timeoutId);
          child.kill('SIGTERM');
          resolve({
            name: 'bash',
            success: false,
            output: `Command timed out after ${timeoutMs}ms.\n${(stdout + '\n' + stderr).trim()}`.trim(),
            duration: Date.now() - start,
          });
        }
      }, timeoutMs);
    }

    child.stdout?.setEncoding('utf8');
    child.stdout?.on('data', (chunk: string) => { stdout += chunk; });
    child.stderr?.setEncoding('utf8');
    child.stderr?.on('data', (chunk: string) => { stderr += chunk; });

    child.on('error', (err: NodeJS.ErrnoException) => {
      if (err.code === 'ENOENT') finish(false, '', `Command not found: ${shell}`);
      else if (err.code === 'EACCES') finish(false, '', 'Permission denied');
      else finish(false, err.message, 'Spawn error');
    });

    child.on('close', (code, signal) => {
      if (resolved) return;
      resolved = true;
      if (timeoutId != null) clearTimeout(timeoutId);
      const combined = (stdout + '\n' + stderr).trim();
      if (signal === 'SIGTERM' || signal === 'SIGKILL') {
        resolve({
          name: 'bash',
          success: false,
          output: `Command cancelled (${signal}).\n${combined}`.trim(),
          duration: Date.now() - start,
        });
        return;
      }
      if (code === 0) {
        resolve({
          name: 'bash',
          success: true,
          output: stdout.trim() || '(no output)',
          duration: Date.now() - start,
        });
        return;
      }
      const prefix = code != null ? `Exit code ${code}` : `Signal ${signal}`;
      resolve({
        name: 'bash',
        success: false,
        output: `${prefix}:\n${combined || 'Command failed'}`.trim(),
        duration: Date.now() - start,
      });
    });

    if (abortSignal?.aborted) {
      child.kill('SIGTERM');
      return;
    }
    abortSignal?.addEventListener('abort', () => {
      child.kill('SIGTERM');
    });
  });
}
