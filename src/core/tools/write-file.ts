import * as fs from 'node:fs';
import * as path from 'node:path';
import type { ToolDefinition, ToolResult } from './types.js';
import { pushUndo } from '../undo-stack.js';

export const writeFileTool: ToolDefinition = {
  name: 'write_file',
  description: 'Create a new file or completely overwrite an existing file with new content.',
  category: 'write',
  parameters: {
    type: 'object',
    properties: {
      path: { type: 'string', description: 'Path to the file to create or overwrite' },
      content: { type: 'string', description: 'The full content to write to the file' },
    },
    required: ['path', 'content'],
  },
};

export function executeWriteFile(args: Record<string, unknown>, cwd: string): ToolResult {
  const start = Date.now();
  const filePath = String(args.path);
  const content = String(args.content);
  const absolutePath = path.resolve(cwd, filePath);

  // Prevent path traversal outside the project
  if (!absolutePath.startsWith(path.resolve(cwd))) {
    return { name: 'write_file', success: false, output: `Access denied: path escapes project directory`, duration: Date.now() - start };
  }

  try {
    const existed = fs.existsSync(absolutePath);
    let oldContent = '';
    if (existed) {
      oldContent = fs.readFileSync(absolutePath, 'utf-8');
    }

    pushUndo(cwd, absolutePath, oldContent, existed);

    // Create parent directories if needed
    const dir = path.dirname(absolutePath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }

    fs.writeFileSync(absolutePath, content, 'utf-8');

    const diff = existed
      ? generateDiff(oldContent, content, filePath)
      : `+++ New file: ${filePath} (${content.split('\n').length} lines)`;

    return {
      name: 'write_file',
      success: true,
      output: existed ? `Updated ${filePath}` : `Created ${filePath}`,
      diff,
      duration: Date.now() - start,
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Unknown error';
    return { name: 'write_file', success: false, output: `Error writing ${filePath}: ${msg}`, duration: Date.now() - start };
  }
}

function generateDiff(oldContent: string, newContent: string, filePath: string): string {
  const oldLines = oldContent.split('\n');
  const newLines = newContent.split('\n');
  const lines: string[] = [`--- a/${filePath}`, `+++ b/${filePath}`];

  let i = 0, j = 0;
  while (i < oldLines.length || j < newLines.length) {
    if (i < oldLines.length && j < newLines.length && oldLines[i] === newLines[j]) {
      i++; j++;
    } else if (i < oldLines.length && (j >= newLines.length || oldLines[i] !== newLines[j])) {
      lines.push(`- ${oldLines[i]}`);
      i++;
    } else {
      lines.push(`+ ${newLines[j]}`);
      j++;
    }
  }

  return lines.join('\n');
}
