import * as fs from 'node:fs';
import * as path from 'node:path';
import type { ToolDefinition, ToolResult } from './types.js';

export const readFileTool: ToolDefinition = {
  name: 'read_file',
  description: 'Read the contents of a file. Use this to examine source code, config files, or any text file.',
  category: 'read',
  parameters: {
    type: 'object',
    properties: {
      path: { type: 'string', description: 'Relative or absolute path to the file to read' },
      start_line: { type: 'number', description: 'Optional start line number (1-indexed)' },
      end_line: { type: 'number', description: 'Optional end line number (1-indexed)' },
    },
    required: ['path'],
  },
};

export function executeReadFile(args: Record<string, unknown>, cwd: string): ToolResult {
  const start = Date.now();
  const filePath = String(args.path);
  const absolutePath = path.resolve(cwd, filePath);

  // Prevent path traversal outside the project
  if (!absolutePath.startsWith(path.resolve(cwd))) {
    return { name: 'read_file', success: false, output: `Access denied: path escapes project directory`, duration: Date.now() - start };
  }

  try {
    if (!fs.existsSync(absolutePath)) {
      return { name: 'read_file', success: false, output: `File not found: ${filePath}`, duration: Date.now() - start };
    }

    const stat = fs.statSync(absolutePath);
    if (stat.isDirectory()) {
      const entries = fs.readdirSync(absolutePath);
      return { name: 'read_file', success: true, output: `Directory listing of ${filePath}:\n${entries.join('\n')}`, duration: Date.now() - start };
    }

    if (stat.size > 500 * 1024) {
      return { name: 'read_file', success: false, output: `File too large: ${filePath} (${(stat.size / 1024).toFixed(0)}KB, max 500KB)`, duration: Date.now() - start };
    }

    let content = fs.readFileSync(absolutePath, 'utf-8');
    const startLine = args.start_line ? Number(args.start_line) : undefined;
    const endLine = args.end_line ? Number(args.end_line) : undefined;

    if (startLine || endLine) {
      const lines = content.split('\n');
      const s = (startLine || 1) - 1;
      const e = endLine || lines.length;
      content = lines.slice(s, e).map((line, i) => `${s + i + 1} | ${line}`).join('\n');
    }

    return { name: 'read_file', success: true, output: content, duration: Date.now() - start };
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Unknown error';
    return { name: 'read_file', success: false, output: `Error reading ${filePath}: ${msg}`, duration: Date.now() - start };
  }
}
