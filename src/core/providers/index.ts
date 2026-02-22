import type { LLMProvider, ProviderType } from './types.js';
import { OllamaProvider } from './ollama.js';
import { AnthropicProvider } from './anthropic.js';
import { OpenRouterProvider } from './openrouter.js';
import { DeepSeekProvider } from './deepseek.js';
import type { AppConfig } from '../../types/index.js';

export function createProvider(config: AppConfig, override?: ProviderType): LLMProvider {
  const type = override ?? config.provider;
  switch (type) {
    case 'anthropic': {
      const token = config.anthropicToken || process.env.CLAUDE_CODE_OAUTH_TOKEN || '';
      if (!token) throw new Error('Anthropic token not set.');
      return new AnthropicProvider(token, config.ollamaTimeout);
    }

    case 'openrouter': {
      const key = config.openrouterApiKey || process.env.OPENROUTER_API_KEY || '';
      if (!key) throw new Error('OpenRouter API key not set.');
      return new OpenRouterProvider(key, config.ollamaTimeout);
    }

    case 'deepseek': {
      const key = config.deepseekApiKey || process.env.DEEPSEEK_API_KEY || '';
      if (!key) throw new Error('DeepSeek API key not set.');
      return new DeepSeekProvider(key, config.ollamaTimeout);
    }

    case 'ollama':
    default:
      return new OllamaProvider(config.ollamaUrl, config.ollamaTimeout);
  }
}

export function getProviderDisplayName(type: ProviderType): string {
  switch (type) {
    case 'anthropic': return 'Anthropic (Claude)';
    case 'openrouter': return 'OpenRouter';
    case 'deepseek': return 'DeepSeek';
    case 'ollama': return 'Ollama';
    default: return type;
  }
}

export { type LLMProvider, type ProviderType, type ModelInfo } from './types.js';
export { OllamaProvider } from './ollama.js';
export { AnthropicProvider } from './anthropic.js';
export { OpenRouterProvider } from './openrouter.js';
export { DeepSeekProvider } from './deepseek.js';
