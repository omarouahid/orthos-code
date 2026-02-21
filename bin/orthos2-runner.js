#!/usr/bin/env node
/**
 * Development runner: runs Orthos from TypeScript source via tsx so you see
 * changes without rebuilding. Use `orthos2` while developing; use `orthos` for
 * the built version.
 */
import { spawnSync } from 'child_process';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.join(__dirname, '..');
const scriptPath = path.join(projectRoot, 'bin', 'orthos.ts');

// Run TypeScript source via tsx (not the dist bundle) so changes apply without rebuilding
const result = spawnSync('npx', ['tsx', scriptPath, ...process.argv.slice(2)], {
  stdio: 'inherit',
  shell: true,
  cwd: projectRoot,
  env: { ...process.env, NODE_NO_WARNINGS: '1' },
});

process.exit(result.status ?? (result.signal ? 128 + 9 : 1));
