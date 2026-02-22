import type { AppConfig } from '../types/index.js';
import type { ProviderType } from './providers/types.js';
import { createProvider } from './providers/index.js';
import { getAvailableModelsCached } from './model-list-cache.js';

export interface FallbackCandidate {
  providerType: ProviderType;
  modelName: string;
  contextLength?: number;
}

const RETRYABLE_PATTERNS = [
  /429/,
  /503/,
  /502/,
  /overload/i,
  /traffic/i,
  /rate limit/i,
  /capacity/i,
  /timeout/i,
  /ETIMEDOUT/i,
  /timed out/i,
  /service unavailable/i,
  /try again/i,
];

export function isRetryableError(message: string): boolean {
  return RETRYABLE_PATTERNS.some((p) => p.test(message));
}

function isProviderConfigured(config: AppConfig, type: ProviderType): boolean {
  switch (type) {
    case 'ollama':
      return !!config.ollamaUrl;
    case 'openrouter':
      return !!(config.openrouterApiKey || process.env.OPENROUTER_API_KEY);
    case 'anthropic':
      return !!(config.anthropicToken || process.env.CLAUDE_CODE_OAUTH_TOKEN);
    case 'deepseek':
      return !!(config.deepseekApiKey || process.env.DEEPSEEK_API_KEY);
    default:
      return false;
  }
}

/**
 * Score a model for a given task (higher = better fit).
 * Uses simple keyword matching: code-related task + model name hints.
 */
function scoreModelForTask(modelName: string, taskText: string): number {
  const name = modelName.toLowerCase();
  const task = (taskText || '').toLowerCase();
  let score = 0;

  const codeTaskWords = ['code', 'implement', 'refactor', 'fix', 'debug', 'write', 'script', 'function', 'api', 'app', 'project'];
  const codeModelHints = ['coder', 'code', 'qwen', 'claude', 'deepseek', 'codellama', 'mistral', 'llama', 'phi', 'command'];
  const generalModelHints = ['gpt', 'claude', 'sonnet', 'opus', 'haiku'];

  const taskIsCodeRelated = codeTaskWords.some((w) => task.includes(w));
  if (taskIsCodeRelated) {
    if (codeModelHints.some((h) => name.includes(h)))) score += 20;
    if (name.includes('coder') || name.includes('code-')) score += 10;
  }
  if (generalModelHints.some((h) => name.includes(h)))) score += 5;
  if (name.includes('large') || name.includes('32') || name.includes('70b')) score += 2;
  return score;
}

/**
 * Build an ordered list of (provider, model) candidates for fallback.
 * Uses all configured providers (Ollama, OpenRouter, etc.), fetches their models,
 * and ranks by task fit when taskText is provided.
 */
export async function getFallbackCandidates(
  config: AppConfig,
  options?: {
    taskText?: string;
    currentProvider?: ProviderType;
    currentModel?: string;
    maxPerProvider?: number;
  }
): Promise<FallbackCandidate[]> {
  const taskText = options?.taskText ?? '';
  const currentProvider = options?.currentProvider ?? config.provider;
  const currentModel = options?.currentModel ?? '';
  const maxPerProvider = options?.maxPerProvider ?? 30;

  const types: ProviderType[] = ['ollama', 'openrouter', 'anthropic', 'deepseek'];
  const all: FallbackCandidate[] = [];

  const TTL_MS = 5 * 60 * 1000;
  for (const type of types) {
    if (!isProviderConfigured(config, type)) continue;
    try {
      const provider = createProvider(config, type);
      const cacheKey = type === 'ollama' ? `ollama:${config.ollamaUrl || 'http://localhost:11434'}` : type;
      const models = await getAvailableModelsCached(provider, cacheKey, TTL_MS);
      for (let i = 0; i < Math.min(models.length, maxPerProvider); i++) {
        const m = models[i];
        all.push({
          providerType: type,
          modelName: m.name,
          contextLength: m.contextLength,
        });
      }
    } catch {
      // Skip this provider if it fails (e.g. no key, network)
    }
  }

  // Score and sort: best match for task first, then by provider preference (current first)
  const scored = all.map((c) => ({
    ...c,
    score:
      scoreModelForTask(c.modelName, taskText) +
      (c.providerType === currentProvider ? 50 : 0) +
      (c.modelName === currentModel ? 100 : 0),
  }));
  scored.sort((a, b) => b.score - a.score);

  return scored.map(({ providerType, modelName, contextLength }) => ({
    providerType,
    modelName,
    contextLength,
  }));
}

/**
 * Find the next fallback candidate after (currentProvider, currentModel).
 * If current is not in the list, returns the first candidate (best for task).
 * Returns null if list is empty.
 */
export function getNextFallback(
  candidates: FallbackCandidate[],
  currentProvider: ProviderType,
  currentModel: string
): FallbackCandidate | null {
  if (candidates.length === 0) return null;
  let found = false;
  for (const c of candidates) {
    if (found) return c;
    if (c.providerType === currentProvider && c.modelName === currentModel) found = true;
  }
  return found ? null : candidates[0];
}
