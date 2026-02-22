import { describe, it, expect, vi, beforeEach } from 'vitest';
import { checkProviderPreflight } from '../src/cli/preflight.js';
import type { AppConfig } from '../src/types/index.js';
import type { LLMProvider } from '../src/core/providers/types.js';

function minimalConfig(overrides: Partial<AppConfig> = {}): AppConfig {
  return {
    provider: 'ollama',
    ollamaUrl: 'http://127.0.0.1:11434',
    ollamaTimeout: 60_000,
    anthropicToken: '',
    openrouterApiKey: '',
    deepseekApiKey: '',
    autoCompact: false,
    contextWindowSize: 128_000,
    thresholdPercent: 80,
    keepRecentMessages: 20,
    maxFileSizeBytes: 512 * 1024,
    maxTotalAttachmentBytes: 2 * 1024 * 1024,
    yolo: false,
    browserWsPort: 0,
    browserAuthToken: '',
    browserEnabled: false,
    telegramBotToken: '',
    telegramEnabled: false,
    telegramAllowedUsers: [],
    telegramVoiceEnabled: false,
    sandboxMode: false,
    ...overrides,
  };
}

describe('checkProviderPreflight', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns empty result when provider is healthy', async () => {
    const provider: LLMProvider = {
      name: 'ollama',
      checkHealth: vi.fn().mockResolvedValue(true),
      getAvailableModels: vi.fn().mockResolvedValue([]),
      getModelContextLength: vi.fn().mockResolvedValue(4096),
      stream: vi.fn(),
    };
    const result = await checkProviderPreflight(minimalConfig(), () => provider);
    expect(result).toEqual({});
    expect(provider.checkHealth).toHaveBeenCalledTimes(1);
  });

  it('returns initialProviderUnhealthy when checkHealth returns false (never throws)', async () => {
    const provider: LLMProvider = {
      name: 'ollama',
      checkHealth: vi.fn().mockResolvedValue(false),
      getAvailableModels: vi.fn().mockResolvedValue([]),
      getModelContextLength: vi.fn().mockResolvedValue(4096),
      stream: vi.fn(),
    };
    const result = await checkProviderPreflight(minimalConfig(), () => provider);
    expect(result).toEqual({ initialProviderUnhealthy: 'Ollama' });
    expect(provider.checkHealth).toHaveBeenCalledTimes(1);
  });

  it('returns initialProviderUnhealthy when checkHealth throws (e.g. rate limit, ECONNREFUSED)', async () => {
    const provider: LLMProvider = {
      name: 'ollama',
      checkHealth: vi.fn().mockRejectedValue(new Error('ECONNREFUSED')),
      getAvailableModels: vi.fn().mockResolvedValue([]),
      getModelContextLength: vi.fn().mockResolvedValue(4096),
      stream: vi.fn(),
    };
    const result = await checkProviderPreflight(minimalConfig(), () => provider);
    expect(result).toEqual({ initialProviderUnhealthy: 'Ollama' });
    expect(provider.checkHealth).toHaveBeenCalledTimes(1);
  });

  it('uses correct provider display name for non-ollama', async () => {
    const provider: LLMProvider = {
      name: 'anthropic',
      checkHealth: vi.fn().mockResolvedValue(false),
      getAvailableModels: vi.fn().mockResolvedValue([]),
      getModelContextLength: vi.fn().mockResolvedValue(4096),
      stream: vi.fn(),
    };
    const result = await checkProviderPreflight(minimalConfig({ provider: 'anthropic' }), () => provider);
    expect(result.initialProviderUnhealthy).toMatch(/Anthropic/);
  });
});
