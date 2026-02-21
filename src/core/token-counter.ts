import { encode } from 'gpt-tokenizer';
import type { Message } from '../types/index.js';

export function countTokens(text: string): number {
  if (!text || text.length === 0) return 0;
  try {
    return encode(text).length;
  } catch {
    return Math.ceil(text.length / 4); // fallback estimate
  }
}

export function countMessageTokens(messages: Message[]): number {
  let total = 0;
  for (const msg of messages) {
    total += 4; // Overhead per message for role/formatting
    total += countTokens(msg.content);
    if (msg.thinking) total += countTokens(msg.thinking);
    if (msg.toolCalls?.length) {
      for (const tc of msg.toolCalls) {
        total += countTokens(tc.name);
        total += countTokens(JSON.stringify(tc.arguments));
      }
    }
  }
  return total;
}
