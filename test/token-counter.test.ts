import { describe, it, expect } from 'vitest';
import { countTokens, countMessageTokens } from '../src/core/token-counter.js';
import type { Message } from '../src/types/index.js';

describe('token counter (unchanged behavior)', () => {
  it('countTokens returns positive number for non-empty string', () => {
    expect(countTokens('hello')).toBeGreaterThan(0);
    expect(countTokens('Hello world')).toBeGreaterThan(0);
  });

  it('countTokens returns 0 for empty string', () => {
    expect(countTokens('')).toBe(0);
  });

  it('countMessageTokens includes message content and overhead', () => {
    const messages: Message[] = [
      { id: '1', role: 'user', content: 'Hi', timestamp: 0 },
      { id: '2', role: 'assistant', content: 'Hello', timestamp: 0 },
    ];
    const n = countMessageTokens(messages);
    expect(n).toBeGreaterThan(countTokens('Hi') + countTokens('Hello'));
    expect(n).toBeLessThanOrEqual(countTokens('Hi') + countTokens('Hello') + 20);
  });

  it('countMessageTokens with tool calls adds tokens', () => {
    const withTool: Message[] = [
      { id: '1', role: 'assistant', content: '', timestamp: 0, toolCalls: [{ name: 'read_file', arguments: { path: 'a.ts' } }] },
    ];
    expect(countMessageTokens(withTool)).toBeGreaterThan(4);
  });
});
