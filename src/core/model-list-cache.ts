import type { LLMProvider } from './providers/types.js';
import type { ModelInfo } from './providers/types.js';
import type { AppConfig } from '../types/index.js';

const CACHE = new Map<string, { models: ModelInfo[]; expiresAt: number }>();

const DEFAULT_TTL_MS = 5 * 60 * 1000; // 5 minutes

/** Build a cache key for the model list from config (provider + url where relevant). */
export function buildModelListCacheKey(config: AppConfig): string {
  const p = config.provider;
  if (p === 'ollama') return `ollama:${config.ollamaUrl || 'http://localhost:11434'}`;
  return p;
}

/**
 * Return available models, using a short TTL cache so picker and fallback don't hammer the API.
 * No timeout: we don't add time limits for model listing.
 */
export async function getAvailableModelsCached(
  provider: LLMProvider,
  cacheKey: string,
  ttlMs: number = DEFAULT_TTL_MS
): Promise<ModelInfo[]> {
  const now = Date.now();
  const entry = CACHE.get(cacheKey);
  if (entry && entry.expiresAt > now) return entry.models;

  const models = await provider.getAvailableModels();
  CACHE.set(cacheKey, { models, expiresAt: now + ttlMs });
  return models;
}

/** Invalidate cache for a key (e.g. after provider change). */
export function invalidateModelListCache(cacheKey: string): void {
  CACHE.delete(cacheKey);
}
