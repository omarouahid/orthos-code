import Conf from 'conf';
import * as fs from 'node:fs';
import * as path from 'node:path';
import type { AppConfig, ConversationData, ProviderType } from '../types/index.js';
import { DEFAULT_CONFIG } from './constants.js';

const PROJECT_CONFIG_FILE = '.orthos.json';
const ALLOWED_PROJECT_KEYS: (keyof AppConfig)[] = [
  'provider', 'ollamaUrl', 'ollamaTimeout', 'anthropicToken', 'openrouterApiKey', 'deepseekApiKey',
  'autoCompact', 'contextWindowSize', 'thresholdPercent', 'keepRecentMessages', 'maxFileSizeBytes', 'maxTotalAttachmentBytes',
  'yolo', 'browserWsPort', 'browserAuthToken', 'browserEnabled', 'sandboxMode',
  'telegramBotToken', 'telegramEnabled', 'telegramAllowedUsers', 'telegramVoiceEnabled',
];

interface StoreSchema {
  settings: AppConfig;
  selectedModel: string;
  selectedModels: Record<string, string>; // per-provider model selection
  conversation: ConversationData | null;
}

const store = new Conf<StoreSchema>({
  projectName: 'orthos-code',
  defaults: {
    settings: DEFAULT_CONFIG,
    selectedModel: '',
    selectedModels: {},
    conversation: null,
  },
});

export function getConfig(): AppConfig {
  const saved = store.get('settings');
  // Merge with defaults for any missing keys
  const config = { ...DEFAULT_CONFIG, ...saved };

  // Environment variable fallbacks for tokens
  if (!config.anthropicToken) {
    config.anthropicToken = process.env.CLAUDE_CODE_OAUTH_TOKEN || '';
  }
  if (!config.openrouterApiKey) {
    config.openrouterApiKey = process.env.OPENROUTER_API_KEY || '';
  }
  if (!config.deepseekApiKey) {
    config.deepseekApiKey = process.env.DEEPSEEK_API_KEY || '';
  }
  if (process.env.ORTHOS_SANDBOX === '1' || process.env.ORTHOS_SANDBOX === 'true') {
    config.sandboxMode = true;
  }

  return config;
}

/** Load project-level overrides from cwd/.orthos.json (merged on top of global config). */
export function getProjectConfig(cwd: string): Partial<AppConfig> | null {
  const p = path.join(cwd, PROJECT_CONFIG_FILE);
  if (!fs.existsSync(p)) return null;
  try {
    const raw = fs.readFileSync(p, 'utf-8');
    const data = JSON.parse(raw) as Record<string, unknown>;
    const out: Partial<AppConfig> = {};
    for (const key of ALLOWED_PROJECT_KEYS) {
      if (data[key] !== undefined) (out as Record<string, unknown>)[key] = data[key];
    }
    return Object.keys(out).length ? out : null;
  } catch {
    return null;
  }
}

/** Global config merged with project .orthos.json when present. Use this when you have a cwd. */
export function getConfigForCwd(cwd: string): AppConfig {
  const base = getConfig();
  const project = getProjectConfig(cwd);
  if (!project) return base;
  return { ...base, ...project };
}

export function setConfig(partial: Partial<AppConfig>): void {
  const current = getConfig();
  store.set('settings', { ...current, ...partial });
}

export function getSelectedModel(): string {
  return store.get('selectedModel');
}

export function setSelectedModel(model: string): void {
  store.set('selectedModel', model);
}

/** Get the saved model for a specific provider */
export function getSelectedModelForProvider(provider: ProviderType): string {
  const models = store.get('selectedModels') || {};
  return models[provider] || '';
}

/** Save the selected model for a specific provider */
export function setSelectedModelForProvider(provider: ProviderType, model: string): void {
  const models = store.get('selectedModels') || {};
  models[provider] = model;
  store.set('selectedModels', models);
  // Also update the global selectedModel
  store.set('selectedModel', model);
}

export function getSavedConversation(): ConversationData | null {
  return store.get('conversation');
}

export function saveConversation(data: ConversationData): void {
  store.set('conversation', data);
}

export function clearConversation(): void {
  store.set('conversation', null);
}
