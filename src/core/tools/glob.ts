import * as fs from 'node:fs';
import * as path from 'node:path';
import type { ToolDefinition, ToolResult } from './types.js';

export const globTool: ToolDefinition = {
  name: 'glob',
  description: 'Find files matching a glob pattern. Returns file paths relative to the search directory.',
  category: 'search',
  parameters: {
    type: 'object',
    properties: {
      pattern: { type: 'string', description: 'Glob pattern (e.g., "**/*.ts", "src/**/*.js", "*.json")' },
      path: { type: 'string', description: 'Directory to search in (default: current directory)' },
    },
    required: ['pattern'],
  },
};

export function executeGlob(args: Record<string, unknown>, cwd: string): ToolResult {
  const start = Date.now();
  const pattern = String(args.pattern);
  const searchPath = args.path ? path.resolve(cwd, String(args.path)) : cwd;

  try {
    const results = walkAndMatch(searchPath, pattern, searchPath);
    const limited = results.slice(0, 100);
    const scanTruncated = (results as any)._truncated;
    const truncated = results.length > 100
      ? `\n... (${results.length - 100} more files, output truncated)`
      : scanTruncated
      ? '\n... (search stopped early — too many files. Use a more specific pattern.)'
      : '';

    if (limited.length === 0) {
      return { name: 'glob', success: true, output: `No files matching "${pattern}"`, duration: Date.now() - start };
    }

    return {
      name: 'glob',
      success: true,
      output: `Found ${results.length} files:\n${limited.join('\n')}${truncated}`,
      duration: Date.now() - start,
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Unknown error';
    return { name: 'glob', success: false, output: `Glob error: ${msg}`, duration: Date.now() - start };
  }
}

function walkAndMatch(dir: string, pattern: string, root: string, results: string[] = []): string[] {
  const SKIP = new Set(['node_modules', '.git', 'dist', '.next', '__pycache__', '.venv', 'venv']);

  try {
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
      if (SKIP.has(entry.name)) continue;
      const fullPath = path.join(dir, entry.name);
      const relPath = path.relative(root, fullPath).replace(/\\/g, '/');

      if (entry.isDirectory()) {
        if (results.length < 500) {
          walkAndMatch(fullPath, pattern, root, results);
        } else {
          // Mark that we hit the limit so caller can warn
          (results as any)._truncated = true;
        }
      } else if (matchGlob(relPath, pattern)) {
        results.push(relPath);
      }
    }
  } catch {
    // Skip unreadable directories
  }

  return results;
}

function matchGlob(filePath: string, pattern: string): boolean {
  // Simple glob matching: *, **, ?
  const regexStr = pattern
    .replace(/\./g, '\\.')
    .replace(/\*\*/g, '{{DOUBLESTAR}}')
    .replace(/\*/g, '[^/]*')
    .replace(/\?/g, '[^/]')
    .replace(/\{\{DOUBLESTAR\}\}/g, '.*');

  return new RegExp(`^${regexStr}$`).test(filePath);
}
