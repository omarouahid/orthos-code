import * as fs from 'node:fs';
import * as path from 'node:path';

const MAX_UNDO = 20;
interface UndoEntry {
  absolutePath: string;
  content: string;
  existed: boolean;
  /** When set, entries with the same turnId are undone together (one message/prompt). */
  turnId?: string;
}

const stackByCwd = new Map<string, UndoEntry[]>();
let currentTurnId: string | null = null;

function getStack(cwd: string): UndoEntry[] {
  let stack = stackByCwd.get(cwd);
  if (!stack) {
    stack = [];
    stackByCwd.set(cwd, stack);
  }
  return stack;
}

/** Set the current "turn" id so all pushUndo calls in this run are grouped. Call with null when the run ends. */
export function setUndoTurnId(turnId: string | null): void {
  currentTurnId = turnId;
}

/** Record state before a write so it can be restored with performUndo. Grouped by turn when setUndoTurnId was set. */
export function pushUndo(cwd: string, absolutePath: string, content: string, existed: boolean): void {
  const stack = getStack(cwd);
  stack.push({ absolutePath, content, existed, turnId: currentTurnId ?? undefined });
  if (stack.length > MAX_UNDO) stack.shift();
}

function applyUndoEntry(cwd: string, entry: UndoEntry): { path: string; description: string } {
  const resolvedCwd = path.resolve(cwd);
  const rel = path.relative(resolvedCwd, entry.absolutePath);
  if (entry.existed) {
    fs.writeFileSync(entry.absolutePath, entry.content, 'utf-8');
    return { path: rel, description: `Restored ${rel} to previous content.` };
  } else {
    if (fs.existsSync(entry.absolutePath)) fs.unlinkSync(entry.absolutePath);
    return { path: rel, description: `Reverted ${rel} (file removed).` };
  }
}

/** Restore all file changes from the last message/prompt in this cwd. Returns summary or null if nothing. */
export function performUndo(cwd: string): { path: string; description: string; revertedCount: number } | null {
  const stack = getStack(cwd);
  const top = stack.pop();
  if (!top) return null;

  const batch: UndoEntry[] = [top];
  const turnId = top.turnId;
  if (turnId != null) {
    while (stack.length > 0 && stack[stack.length - 1].turnId === turnId) {
      batch.push(stack.pop()!);
    }
  }
  const resolvedCwd = path.resolve(cwd);
  const results: string[] = [];
  let revertedCount = 0;
  for (let i = batch.length - 1; i >= 0; i--) {
    try {
      const r = applyUndoEntry(resolvedCwd, batch[i]);
      results.push(r.description);
      revertedCount++;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      results.push(`Undo failed (${path.relative(resolvedCwd, batch[i].absolutePath)}): ${msg}`);
    }
  }
  const description =
    revertedCount === 1
      ? results[0]!
      : `Reverted last message (${revertedCount} file(s)): ${results.join('; ')}`;
  return {
    path: batch.map((e) => path.relative(resolvedCwd, e.absolutePath)).join(', '),
    description,
    revertedCount,
  };
}

/** Number of file-change entries on the stack (for display). */
export function undoCount(cwd: string): number {
  return getStack(cwd).length;
}

/** Number of "messages" (groups) that can be undone: each distinct turn or single entry counts as one. */
export function undoMessageCount(cwd: string): number {
  const stack = getStack(cwd);
  if (stack.length === 0) return 0;
  let messages = 0;
  let i = stack.length - 1;
  while (i >= 0) {
    messages++;
    const turnId = stack[i]!.turnId;
    if (turnId == null) {
      i--;
      continue;
    }
    while (i >= 0 && stack[i]!.turnId === turnId) i--;
  }
  return messages;
}

/** Peek at the undo stack (oldest first): list of { path, existed, turnId } for display. Path is relative to cwd. */
export function getUndoStackPreview(cwd: string): Array<{ path: string; existed: boolean; turnId?: string }> {
  const stack = getStack(cwd);
  const resolvedCwd = path.resolve(cwd);
  return stack.map((e) => ({
    path: path.relative(resolvedCwd, e.absolutePath),
    existed: e.existed,
    turnId: e.turnId,
  }));
}
