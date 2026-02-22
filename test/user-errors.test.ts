import { describe, it, expect } from 'vitest';
import { toUserFriendlyError } from '../src/core/user-errors.js';

describe('toUserFriendlyError', () => {
  it('maps 429 to rate limit message', () => {
    expect(toUserFriendlyError('429 Too Many Requests')).toMatch(/rate limit/i);
  });

  it('maps 503 to unavailable message', () => {
    expect(toUserFriendlyError('503 Service Unavailable')).toMatch(/temporarily unavailable|Try again/i);
  });

  it('maps 401 to API key message', () => {
    expect(toUserFriendlyError('401 Unauthorized')).toMatch(/API key|setup/i);
  });

  it('maps context limit to compact message', () => {
    expect(toUserFriendlyError('400 context length exceeded')).toMatch(/Context limit|compacted/i);
  });

  it('maps network errors', () => {
    expect(toUserFriendlyError('ECONNREFUSED')).toMatch(/Network|connection/i);
  });

  it('returns short strings unchanged', () => {
    const short = 'Something went wrong';
    expect(toUserFriendlyError(short)).toBe(short);
  });

  it('truncates long unknown errors', () => {
    const long = 'x'.repeat(150);
    expect(toUserFriendlyError(long).length).toBeLessThanOrEqual(120);
    expect(toUserFriendlyError(long)).toMatch(/\.\.\.$/);
  });
});
