import Anthropic from '@anthropic-ai/sdk';
import type { Message, StreamResult } from '../../types/index.js';
import type { ToolDefinition } from '../tools/types.js';
import type { LLMProvider, ModelInfo } from './types.js';

const DEFAULT_TIMEOUT = 120000;

/** Known model limits — the API doesn't return context/output info, so we maintain a lookup */
interface KnownModelLimits {
  contextLength: number;
  maxOutputTokens: number;
}

const KNOWN_LIMITS: Record<string, KnownModelLimits> = {
  // Claude 4 family — 200K context, 64K output
  'claude-sonnet-4-20250514':   { contextLength: 200000, maxOutputTokens: 64000 },
  'claude-opus-4-20250514':     { contextLength: 200000, maxOutputTokens: 64000 },
  // Claude 4.5 family
  'claude-haiku-4-5-20251001':  { contextLength: 200000, maxOutputTokens: 64000 },
  // Claude 3.5 family — 200K context, 8K output
  'claude-3-5-sonnet-20241022': { contextLength: 200000, maxOutputTokens: 8192 },
  'claude-3-5-haiku-20241022':  { contextLength: 200000, maxOutputTokens: 8192 },
  // Claude 3 family
  'claude-3-opus-20240229':     { contextLength: 200000, maxOutputTokens: 4096 },
  'claude-3-sonnet-20240229':   { contextLength: 200000, maxOutputTokens: 4096 },
  'claude-3-haiku-20240307':    { contextLength: 200000, maxOutputTokens: 4096 },
};

/** Guess limits for unknown models based on name patterns */
function guessModelLimits(modelId: string): KnownModelLimits {
  const id = modelId.toLowerCase();
  // Claude 4+ models get 64K output
  if (id.includes('claude-4') || id.includes('claude-opus-4') || id.includes('claude-sonnet-4') || id.includes('claude-haiku-4')) {
    return { contextLength: 200000, maxOutputTokens: 64000 };
  }
  // Claude 3.5 models get 8K output
  if (id.includes('claude-3-5') || id.includes('claude-3.5')) {
    return { contextLength: 200000, maxOutputTokens: 8192 };
  }
  // Default for any other Claude model
  return { contextLength: 200000, maxOutputTokens: 16384 };
}

/** Get limits for a model (known lookup → pattern guess) */
function getModelLimits(modelId: string): KnownModelLimits {
  return KNOWN_LIMITS[modelId] ?? guessModelLimits(modelId);
}

/** Hardcoded fallback list in case the API call fails */
const FALLBACK_MODELS: ModelInfo[] = [
  { name: 'claude-sonnet-4-20250514', displayName: 'Claude Sonnet 4', provider: 'anthropic', contextLength: 200000 },
  { name: 'claude-opus-4-20250514', displayName: 'Claude Opus 4', provider: 'anthropic', contextLength: 200000 },
  { name: 'claude-haiku-4-5-20251001', displayName: 'Claude Haiku 4.5', provider: 'anthropic', contextLength: 200000 },
  { name: 'claude-3-5-sonnet-20241022', displayName: 'Claude 3.5 Sonnet', provider: 'anthropic', contextLength: 200000 },
  { name: 'claude-3-5-haiku-20241022', displayName: 'Claude 3.5 Haiku', provider: 'anthropic', contextLength: 200000 },
];

export class AnthropicProvider implements LLMProvider {
  readonly name = 'anthropic' as const;
  private client: Anthropic;
  private timeout: number;
  private cachedModels: ModelInfo[] | null = null;

  constructor(token: string, timeout = DEFAULT_TIMEOUT) {
    this.client = new Anthropic({
      apiKey: token, // OAuth token (sk-ant-oat01-...) works as apiKey
    });
    this.timeout = timeout;
  }

  private get authHeaders(): Record<string, string> {
    return {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${this.client.apiKey}`,
      'anthropic-version': '2023-06-01',
    };
  }

  async checkHealth(): Promise<boolean> {
    try {
      // Use the models list endpoint as a lightweight health check
      const response = await fetch('https://api.anthropic.com/v1/models?limit=1', {
        headers: this.authHeaders,
        signal: AbortSignal.timeout(10000),
      });
      return response.status !== 401 && response.status !== 403;
    } catch {
      return false;
    }
  }

  async getAvailableModels(): Promise<ModelInfo[]> {
    if (this.cachedModels) return this.cachedModels;

    try {
      const models: ModelInfo[] = [];
      let afterId: string | undefined;
      let hasMore = true;

      // Paginate through all models
      while (hasMore) {
        const url = new URL('https://api.anthropic.com/v1/models');
        url.searchParams.set('limit', '100');
        if (afterId) url.searchParams.set('after_id', afterId);

        const response = await fetch(url.toString(), {
          headers: this.authHeaders,
          signal: AbortSignal.timeout(15000),
        });

        if (!response.ok) throw new Error(`API returned ${response.status}`);

        const body = await response.json() as {
          data: Array<{ id: string; display_name?: string; created_at?: string }>;
          has_more: boolean;
          last_id?: string;
        };

        for (const m of body.data) {
          const limits = getModelLimits(m.id);
          models.push({
            name: m.id,
            displayName: m.display_name || m.id,
            provider: 'anthropic',
            contextLength: limits.contextLength,
          });
        }

        hasMore = body.has_more && !!body.last_id;
        afterId = body.last_id;
      }

      if (models.length > 0) {
        this.cachedModels = models;
        return models;
      }
    } catch {
      // API call failed — fall back to hardcoded list
    }

    this.cachedModels = FALLBACK_MODELS;
    return FALLBACK_MODELS;
  }

  async getModelContextLength(modelName: string): Promise<number> {
    return getModelLimits(modelName).contextLength;
  }

  formatTools(tools: ToolDefinition[]): object[] {
    return tools.map((tool) => ({
      name: tool.name,
      description: tool.description,
      input_schema: tool.parameters,
    }));
  }

  async streamChat(
    model: string,
    messages: Message[],
    systemPrompt: string,
    onChunk: (chunk: string) => void,
    abortSignal?: AbortSignal,
    timeout = this.timeout,
    tools?: ToolDefinition[],
    onThinkingChunk?: (chunk: string) => void,
  ): Promise<StreamResult> {
    // Convert internal messages to Anthropic format
    const anthropicMessages = this.convertMessages(messages);

    // Use the model's max output tokens (64K for Claude 4, 8K for Claude 3.5)
    const maxTokens = getModelLimits(model).maxOutputTokens;

    const params: Record<string, unknown> = {
      model,
      max_tokens: maxTokens,
      system: systemPrompt,
      messages: anthropicMessages,
      stream: true,
    };

    if (tools && tools.length > 0) {
      params.tools = this.formatTools(tools);
    }

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeout);
    if (abortSignal) {
      abortSignal.addEventListener('abort', () => controller.abort());
    }

    let fullContent = '';
    let fullThinking = '';
    let promptTokens = 0;
    let responseTokens = 0;
    let toolCalls: Array<{ name: string; arguments: Record<string, unknown> }> = [];

    // Track tool use blocks being built
    let currentToolName = '';
    let currentToolInput = '';
    let currentToolId = '';

    // Batch content for smoother UI
    let batchBuffer = '';
    let batchTimer: NodeJS.Timeout | null = null;
    const BATCH_DELAY = 10;

    try {
      const response = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${this.client.apiKey}`,
          'anthropic-version': '2023-06-01',
        },
        body: JSON.stringify(params),
        signal: controller.signal,
      });

      clearTimeout(timeoutId);

      if (!response.ok) {
        const errorBody = await response.text().catch(() => '');
        throw new Error(`Anthropic API returned ${response.status}: ${errorBody}`);
      }

      const reader = response.body?.getReader();
      if (!reader) throw new Error('No response body from Anthropic');

      const decoder = new TextDecoder();
      let buffer = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');

        for (let i = 0; i < lines.length - 1; i++) {
          const line = lines[i].trim();
          if (!line || line.startsWith(':')) continue; // Skip empty lines and comments

          if (line.startsWith('data: ')) {
            const data = line.slice(6);
            if (data === '[DONE]') continue;

            try {
              const event = JSON.parse(data);

              switch (event.type) {
                case 'content_block_start': {
                  if (event.content_block?.type === 'tool_use') {
                    currentToolName = event.content_block.name || '';
                    currentToolId = event.content_block.id || '';
                    currentToolInput = '';
                  }
                  break;
                }

                case 'content_block_delta': {
                  const delta = event.delta;
                  if (delta?.type === 'text_delta' && delta.text) {
                    fullContent += delta.text;
                    batchBuffer += delta.text;

                    if (batchTimer) clearTimeout(batchTimer);
                    batchTimer = setTimeout(() => {
                      if (batchBuffer) {
                        onChunk(batchBuffer);
                        batchBuffer = '';
                      }
                    }, BATCH_DELAY);
                  } else if (delta?.type === 'thinking_delta' && delta.thinking) {
                    fullThinking += delta.thinking;
                    onThinkingChunk?.(delta.thinking);
                  } else if (delta?.type === 'input_json_delta' && delta.partial_json) {
                    currentToolInput += delta.partial_json;
                  }
                  break;
                }

                case 'content_block_stop': {
                  if (currentToolName) {
                    let args: Record<string, unknown> = {};
                    try {
                      args = JSON.parse(currentToolInput || '{}');
                    } catch {
                      args = {};
                    }
                    toolCalls.push({ name: currentToolName, arguments: args });
                    currentToolName = '';
                    currentToolInput = '';
                    currentToolId = '';
                  }
                  break;
                }

                case 'message_delta': {
                  if (event.usage) {
                    responseTokens = event.usage.output_tokens || 0;
                  }
                  break;
                }

                case 'message_start': {
                  if (event.message?.usage) {
                    promptTokens = event.message.usage.input_tokens || 0;
                  }
                  break;
                }
              }
            } catch {
              // Skip invalid JSON
            }
          }
        }

        buffer = lines[lines.length - 1];
      }

      // Flush remaining batch
      if (batchTimer) {
        clearTimeout(batchTimer);
        if (batchBuffer) onChunk(batchBuffer);
      }
    } catch (error) {
      if (batchTimer) clearTimeout(batchTimer);
      clearTimeout(timeoutId);
      if (error instanceof Error && error.name === 'AbortError') {
        return {
          content: fullContent,
          promptTokens,
          responseTokens,
          totalTokens: promptTokens + responseTokens,
          thinking: fullThinking || undefined,
        };
      }
      throw error;
    }

    return {
      content: fullContent,
      promptTokens,
      responseTokens,
      totalTokens: promptTokens + responseTokens,
      toolCalls: toolCalls.length > 0 ? toolCalls : undefined,
      thinking: fullThinking || undefined,
    };
  }

  /** Convert internal Message[] to Anthropic message format */
  private convertMessages(messages: Message[]): object[] {
    const result: object[] = [];

    for (const m of messages) {
      if (m.role === 'system') continue; // System prompt sent separately

      if (m.role === 'tool') {
        // Tool results in Anthropic format: role=user with tool_result content blocks
        let toolData: { name?: string; result?: string; success?: boolean } = {};
        try {
          toolData = JSON.parse(m.content);
        } catch {
          toolData = { result: m.content };
        }

        // Find the matching tool call to get its ID
        // Anthropic requires tool_use_id; we'll use the tool name as a fallback
        result.push({
          role: 'user',
          content: [
            {
              type: 'tool_result',
              tool_use_id: toolData.name || 'unknown',
              content: toolData.result || m.content,
              is_error: toolData.success === false,
            },
          ],
        });
      } else if (m.role === 'assistant' && m.toolCalls && m.toolCalls.length > 0) {
        // Assistant message with tool calls
        const content: object[] = [];
        if (m.content) {
          content.push({ type: 'text', text: m.content });
        }
        for (const tc of m.toolCalls) {
          content.push({
            type: 'tool_use',
            id: tc.name, // Use tool name as ID (Anthropic needs unique IDs)
            name: tc.name,
            input: tc.arguments,
          });
        }
        result.push({ role: 'assistant', content });
      } else {
        result.push({
          role: m.role,
          content: m.content,
        });
      }
    }

    return result;
  }
}
