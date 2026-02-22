import * as fs from 'node:fs';
import * as path from 'node:path';
import type { ToolDefinition, ToolResult } from './types.js';
import { pushUndo } from '../undo-stack.js';

export const editFileTool: ToolDefinition = {
  name: 'edit_file',
  description: 'Edit a file by replacing a specific string with new content. The old_string must match exactly.',
  category: 'write',
  parameters: {
    type: 'object',
    properties: {
      path: { type: 'string', description: 'Path to the file to edit' },
      old_string: { type: 'string', description: 'The exact string to find and replace' },
      new_string: { type: 'string', description: 'The replacement string' },
    },
    required: ['path', 'old_string', 'new_string'],
  },
};

export function executeEditFile(args: Record<string, unknown>, cwd: string): ToolResult {
  const start = Date.now();
  const filePath = String(args.path);
  const oldString = String(args.old_string);
  const newString = String(args.new_string);
  const absolutePath = path.resolve(cwd, filePath);

  // Prevent path traversal outside the project
  if (!absolutePath.startsWith(path.resolve(cwd))) {
    return { name: 'edit_file', success: false, output: `Access denied: path escapes project directory`, duration: Date.now() - start };
  }

  try {
    if (!fs.existsSync(absolutePath)) {
      return { name: 'edit_file', success: false, output: `File not found: ${filePath}`, duration: Date.now() - start };
    }

    const content = fs.readFileSync(absolutePath, 'utf-8');
    const occurrences = content.split(oldString).length - 1;

    if (occurrences === 0) {
      return { name: 'edit_file', success: false, output: `String not found in ${filePath}. Make sure old_string matches exactly.`, duration: Date.now() - start };
    }

    if (occurrences > 1) {
      return { name: 'edit_file', success: false, output: `Found ${occurrences} occurrences of old_string in ${filePath}. Provide more context to make it unique.`, duration: Date.now() - start };
    }

    const newContent = content.replace(oldString, newString);
    pushUndo(cwd, absolutePath, content, true);
    fs.writeFileSync(absolutePath, newContent, 'utf-8');

    // Build a compact diff
    const diffLines: string[] = [`--- a/${filePath}`, `+++ b/${filePath}`];
    const oldLines = oldString.split('\n');
    const newLines = newString.split('\n');
    for (const line of oldLines) diffLines.push(`- ${line}`);
    for (const line of newLines) diffLines.push(`+ ${line}`);

    return {
      name: 'edit_file',
      success: true,
      output: `Edited ${filePath} (replaced 1 occurrence)`,
      diff: diffLines.join('\n'),
      duration: Date.now() - start,
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Unknown error';
    return { name: 'edit_file', success: false, output: `Error editing ${filePath}: ${msg}`, duration: Date.now() - start };
  }
}
