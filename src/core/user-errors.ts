/**
 * Map provider/API error messages to short, user-friendly text and suggestions.
 * No timeout messages for models/tools — we don't add time limits.
 */

export function toUserFriendlyError(raw: string): string {
  const lower = raw.toLowerCase();

  if (/429|rate limit|too many requests/i.test(lower)) {
    return 'Rate limit hit. Try again in a minute or switch provider/model (/model).';
  }
  if (/503|502|service unavailable|overload|capacity/i.test(lower)) {
    return 'Provider temporarily unavailable. Try again shortly or switch provider/model (/model).';
  }
  if (/401|403|unauthorized|forbidden|invalid.*(api|key|token)|authentication/i.test(lower)) {
    return 'Invalid or missing API key. Run /setup for your provider and add your key.';
  }
  if (/400.*context|context length|token.*limit|max.*token/i.test(lower)) {
    return 'Context limit reached. Conversation was compacted; you can continue.';
  }
  if (/econnrefused|econnreset|etimedout|network|fetch failed/i.test(lower)) {
    return 'Network error. Check your connection and provider (e.g. Ollama: ollama serve).';
  }

  // Keep original if short enough; otherwise truncate
  if (raw.length <= 120) return raw;
  return raw.slice(0, 117) + '...';
}
