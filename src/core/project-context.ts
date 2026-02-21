import * as fs from 'node:fs';
import * as path from 'node:path';

const CONTEXT_FILES = ['ORTHOS.md', 'CLAUDE.md', '.orthos', '.claude'];

export function loadProjectContext(cwd: string): string {
  const parts: string[] = [];

  // Load project instructions file
  for (const file of CONTEXT_FILES) {
    const filePath = path.join(cwd, file);
    if (fs.existsSync(filePath) && fs.statSync(filePath).isFile()) {
      const content = fs.readFileSync(filePath, 'utf-8');
      parts.push(`[Project instructions from ${file}]\n${content}`);
      break;
    }
  }

  // Detect project type
  const projectType = detectProjectType(cwd);
  if (projectType) {
    parts.push(`[Project type: ${projectType}]`);
  }

  // List top-level structure
  try {
    const entries = fs.readdirSync(cwd, { withFileTypes: true });
    const relevant = entries
      .filter((e) => !e.name.startsWith('.') && e.name !== 'node_modules' && e.name !== 'dist')
      .map((e) => (e.isDirectory() ? `${e.name}/` : e.name))
      .slice(0, 30);
    parts.push(`[Project structure]\n${relevant.join('\n')}`);
  } catch {
    // Skip if can't read
  }

  // Check for git
  const gitDir = path.join(cwd, '.git');
  if (fs.existsSync(gitDir)) {
    parts.push('[Git repository detected]');
    try {
      const branch = fs.readFileSync(path.join(gitDir, 'HEAD'), 'utf-8').trim();
      const branchName = branch.replace('ref: refs/heads/', '');
      parts.push(`[Current branch: ${branchName}]`);
    } catch {
      // Skip
    }
  }

  return parts.join('\n\n');
}

function detectProjectType(cwd: string): string | null {
  const checks: Array<[string, string]> = [
    ['package.json', 'Node.js/JavaScript'],
    ['Cargo.toml', 'Rust'],
    ['go.mod', 'Go'],
    ['requirements.txt', 'Python'],
    ['pyproject.toml', 'Python'],
    ['Gemfile', 'Ruby'],
    ['pom.xml', 'Java/Maven'],
    ['build.gradle', 'Java/Gradle'],
    ['composer.json', 'PHP'],
    ['CMakeLists.txt', 'C/C++'],
    ['Makefile', 'Make'],
    ['Dockerfile', 'Docker'],
  ];

  for (const [file, type] of checks) {
    if (fs.existsSync(path.join(cwd, file))) return type;
  }
  return null;
}

export function saveProjectMemory(cwd: string, content: string): void {
  const filePath = path.join(cwd, 'ORTHOS.md');
  fs.writeFileSync(filePath, content, 'utf-8');
}

/**
 * Auto-create ORTHOS.md in the project root if no context file exists.
 * This gives the AI persistent project context, like Claude Code's CLAUDE.md.
 */
export function ensureProjectContext(cwd: string): void {
  // Don't create if any context file already exists
  for (const file of CONTEXT_FILES) {
    const filePath = path.join(cwd, file);
    if (fs.existsSync(filePath)) return;
  }

  const projectType = detectProjectType(cwd);
  const filePath = path.join(cwd, 'ORTHOS.md');

  const content = `# Project Context

This file provides persistent context to Orthos Code (AI coding assistant).
It is auto-generated and you can edit it to customize the AI's behavior.

## Project
${projectType ? `- Type: ${projectType}` : '- Type: Unknown'}
- Root: ${cwd.replace(/\\/g, '/')}

## Instructions
<!-- Add custom instructions for the AI here. For example: -->
<!-- - Always use TypeScript strict mode -->
<!-- - Prefer functional components -->
<!-- - Run tests with: npm test -->

## Notes
<!-- The AI will reference this file for project context. -->
<!-- You can add architecture notes, conventions, or preferences here. -->
`;

  try {
    fs.writeFileSync(filePath, content, 'utf-8');
  } catch {
    // Silently fail if we can't write (read-only filesystem, permissions, etc.)
  }
}
