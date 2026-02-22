import { execSync, execFileSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as path from 'node:path';
import type { ToolDefinition, ToolResult } from './types.js';

export const grepTool: ToolDefinition = {
  name: 'grep',
  description: 'Search file contents for a pattern (regex supported). Returns matching lines with file paths and line numbers.',
  category: 'search',
  parameters: {
    type: 'object',
    properties: {
      pattern: { type: 'string', description: 'Regex pattern to search for' },
      path: { type: 'string', description: 'Directory or file to search in (default: current directory)' },
      include: { type: 'string', description: 'File glob pattern to include (e.g., "*.ts", "*.py")' },
    },
    required: ['pattern'],
  },
};

export function executeGrep(args: Record<string, unknown>, cwd: string): ToolResult {
  const start = Date.now();
  const pattern = String(args.pattern);
  const resolvedCwd = path.resolve(cwd);
  const searchPath = args.path ? path.resolve(cwd, String(args.path)) : resolvedCwd;
  if (searchPath !== resolvedCwd && !searchPath.startsWith(resolvedCwd + path.sep)) {
    return { name: 'grep', success: false, output: 'Access denied: path escapes project directory', duration: Date.now() - start };
  }
  const include = args.include ? String(args.include) : undefined;

  try {
    // Use execFileSync with arg arrays to prevent command injection
    let grepArgs: string[];
    let cmd: string;

    try {
      execSync('rg --version', { stdio: 'pipe' });
      cmd = 'rg';
      grepArgs = ['-n', '--max-count', '50', '--max-filesize', '100K'];
      if (include) grepArgs.push('--glob', include);
      grepArgs.push(pattern, searchPath);
    } catch {
      cmd = 'grep';
      grepArgs = ['-rn', '--max-count=50'];
      if (include) grepArgs.push(`--include=${include}`);
      grepArgs.push(pattern, searchPath);
    }

    const output = execFileSync(cmd, grepArgs, {
      cwd: resolvedCwd,
      encoding: 'utf-8',
      timeout: 15000,
      maxBuffer: 512 * 1024,
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    const lines = output.trim().split('\n');
    const truncated = lines.length >= 50 ? '\n... (results truncated at 50 matches)' : '';

    return {
      name: 'grep',
      success: true,
      output: `Found ${lines.length} matches:\n${output.trim()}${truncated}`,
      duration: Date.now() - start,
    };
  } catch (err: any) {
    if (err.status === 1) {
      return { name: 'grep', success: true, output: 'No matches found.', duration: Date.now() - start };
    }
    return { name: 'grep', success: false, output: `Search error: ${err.message}`, duration: Date.now() - start };
  }
}
