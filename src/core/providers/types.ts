import type { Message, StreamResult } from '../../types/index.js';
import type { ToolDefinition } from '../tools/types.js';

export type ProviderType = 'ollama' | 'anthropic' | 'openrouter' | 'deepseek';

export interface ModelInfo {
  name: string;
  displayName?: string;
  provider: string;
  contextLength?: number;
  size?: number;
  modified_at?: string;
}

export interface LLMProvider {
  readonly name: ProviderType;

  /** Check if the provider is reachable / API key is valid */
  checkHealth(): Promise<boolean>;

  /** List available models for this provider */
  getAvailableModels(): Promise<ModelInfo[]>;

  /** Get the context window size for a specific model */
  getModelContextLength(modelName: string): Promise<number>;

  /** Stream a chat completion, calling onChunk/onThinkingChunk as content arrives */
  streamChat(
    model: string,
    messages: Message[],
    systemPrompt: string,
    onChunk: (chunk: string) => void,
    abortSignal?: AbortSignal,
    timeout?: number,
    tools?: ToolDefinition[],
    onThinkingChunk?: (chunk: string) => void,
  ): Promise<StreamResult>;

  /** Convert internal tool definitions to the provider's expected format */
  formatTools(tools: ToolDefinition[]): object[];
}
