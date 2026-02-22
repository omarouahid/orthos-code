import { describe, it, expect } from 'vitest';
import * as path from 'node:path';

/**
 * Same path-under-cwd check used by grep and glob (and read_file, write_file, edit_file).
 * Ensures resolved path does not escape project directory.
 */
function isPathUnderCwd(resolvedPath: string, cwd: string): boolean {
  const resolvedCwd = path.resolve(cwd);
  return resolvedPath === resolvedCwd || resolvedPath.startsWith(resolvedCwd + path.sep);
}

describe('path security (stay under cwd)', () => {
  const cwd = path.resolve('/project');

  it('allows cwd itself', () => {
    expect(isPathUnderCwd(path.resolve(cwd), cwd)).toBe(true);
  });

  it('allows subdirectory', () => {
    expect(isPathUnderCwd(path.resolve(cwd, 'src'), cwd)).toBe(true);
    expect(isPathUnderCwd(path.resolve(cwd, 'src/foo'), cwd)).toBe(true);
  });

  it('rejects parent escape', () => {
    expect(isPathUnderCwd(path.resolve(cwd, '..'), cwd)).toBe(false);
    expect(isPathUnderCwd(path.resolve(cwd, '../etc'), cwd)).toBe(false);
    expect(isPathUnderCwd(path.resolve(cwd, 'src/../../../etc'), cwd)).toBe(false);
  });

  it('rejects sibling directory', () => {
    expect(isPathUnderCwd(path.resolve(cwd, '..', 'other'), cwd)).toBe(false);
  });
});
