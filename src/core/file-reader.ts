import * as fs from 'node:fs';
import * as path from 'node:path';
import type { FileAttachment } from '../types/index.js';
import { countTokens } from './token-counter.js';

const FILE_REFERENCE_REGEX = /@([\w.\/\\:~-]+(?:[\w.\/\\-])*)/g;

const MAX_FILE_SIZE = 100 * 1024; // 100KB
const MAX_TOTAL_SIZE = 500 * 1024; // 500KB

const EXTENSION_MAP: Record<string, string> = {
  ts: 'typescript', tsx: 'typescript', js: 'javascript', jsx: 'javascript',
  py: 'python', rb: 'ruby', go: 'go', rs: 'rust', java: 'java',
  c: 'c', cpp: 'cpp', h: 'c', hpp: 'cpp', cs: 'csharp',
  php: 'php', swift: 'swift', kt: 'kotlin', scala: 'scala',
  sh: 'bash', bash: 'bash', zsh: 'bash', fish: 'fish',
  sql: 'sql', html: 'html', css: 'css', scss: 'scss', less: 'less',
  json: 'json', yaml: 'yaml', yml: 'yaml', toml: 'toml', xml: 'xml',
  md: 'markdown', txt: 'plaintext', env: 'plaintext',
  dockerfile: 'dockerfile', makefile: 'makefile',
};

function getLanguage(filePath: string): string {
  const ext = path.extname(filePath).slice(1).toLowerCase();
  const basename = path.basename(filePath).toLowerCase();
  if (basename === 'dockerfile') return 'dockerfile';
  if (basename === 'makefile') return 'makefile';
  return EXTENSION_MAP[ext] || 'plaintext';
}

function isBinary(buffer: Buffer): boolean {
  const check = buffer.subarray(0, 512);
  for (let i = 0; i < check.length; i++) {
    if (check[i] === 0) return true;
  }
  return false;
}

export interface FileResolveResult {
  cleanInput: string;
  attachments: FileAttachment[];
  errors: string[];
}

export function resolveFileReferences(input: string, cwd: string): FileResolveResult {
  const attachments: FileAttachment[] = [];
  const errors: string[] = [];
  let totalSize = 0;

  const matches = [...input.matchAll(FILE_REFERENCE_REGEX)];
  let cleanInput = input;

  for (const match of matches) {
    const filePath = match[1];
    const absolutePath = path.resolve(cwd, filePath);

    if (!fs.existsSync(absolutePath)) {
      continue; // Not a file reference, leave as-is
    }

    const stat = fs.statSync(absolutePath);
    if (!stat.isFile()) {
      errors.push(`@${filePath} is a directory, not a file`);
      continue;
    }

    if (stat.size > MAX_FILE_SIZE) {
      errors.push(`@${filePath} is too large (${formatBytes(stat.size)}, max ${formatBytes(MAX_FILE_SIZE)})`);
      continue;
    }

    if (totalSize + stat.size > MAX_TOTAL_SIZE) {
      errors.push(`Total attachment size would exceed ${formatBytes(MAX_TOTAL_SIZE)} limit`);
      continue;
    }

    const buffer = fs.readFileSync(absolutePath);
    if (isBinary(buffer)) {
      errors.push(`@${filePath} appears to be a binary file`);
      continue;
    }

    const content = buffer.toString('utf-8');
    totalSize += stat.size;

    attachments.push({
      path: filePath,
      absolutePath,
      content,
      language: getLanguage(filePath),
      size: stat.size,
    });

    cleanInput = cleanInput.replace(`@${filePath}`, `[File: ${filePath}]`);
  }

  return { cleanInput, attachments, errors };
}

export function buildFileContext(attachments: FileAttachment[]): string {
  if (attachments.length === 0) return '';

  let context = '\n\n--- Attached Files ---\n';
  for (const att of attachments) {
    context += `\nFile: ${att.path} (${formatBytes(att.size)})\n`;
    context += '```' + att.language + '\n';
    context += att.content + '\n';
    context += '```\n';
  }
  return context;
}

export function getFileCompletions(partial: string, cwd: string): string[] {
  const dir = path.dirname(partial) || '.';
  const base = path.basename(partial);
  const fullDir = path.resolve(cwd, dir);

  try {
    const entries = fs.readdirSync(fullDir, { withFileTypes: true });
    return entries
      .filter((e) => e.name.startsWith(base) && !e.name.startsWith('.'))
      .map((e) => {
        const rel = dir === '.' ? e.name : path.join(dir, e.name);
        return e.isDirectory() ? rel + '/' : rel;
      })
      .slice(0, 10);
  } catch {
    return [];
  }
}

function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return Math.round((bytes / Math.pow(k, i)) * 100) / 100 + ' ' + sizes[i];
}
