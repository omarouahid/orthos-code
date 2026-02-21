import type { Message, StreamResult } from '../../types/index.js';
import type { ToolDefinition } from '../tools/types.js';
import type { LLMProvider, ModelInfo } from './types.js';

const DEFAULT_URL = 'http://localhost:11434';
const DEFAULT_TIMEOUT = 120000;
const DEFAULT_CONTEXT = 32768; // Conservative default — most modern models support at least 32K

/** Guess context window from model name when Ollama doesn't report it */
function guessContextLength(modelName: string): number {
  const name = modelName.toLowerCase();
  // Models known to support large context windows
  if (name.includes('qwen') && name.includes('2.5')) return 131072;
  if (name.includes('qwen3')) return 131072;
  if (name.includes('qwen2')) return 131072;
  if (name.includes('deepseek')) return 131072;
  if (name.includes('mistral') && name.includes('large')) return 131072;
  if (name.includes('mistral') && name.includes('nemo')) return 131072;
  if (name.includes('mistral') && name.includes('small')) return 131072;
  if (name.includes('mixtral')) return 32768;
  if (name.includes('llama3') || name.includes('llama-3') || name.includes('llama:3')) return 131072;
  if (name.includes('llama2') || name.includes('llama-2') || name.includes('llama:2')) return 4096;
  if (name.includes('gemma2') || name.includes('gemma:2') || name.includes('gemma-2')) return 8192;
  if (name.includes('gemma3') || name.includes('gemma:3') || name.includes('gemma-3')) return 131072;
  if (name.includes('phi4') || name.includes('phi-4') || name.includes('phi:4')) return 16384;
  if (name.includes('phi3') || name.includes('phi-3') || name.includes('phi:3')) return 131072;
  if (name.includes('codellama')) return 16384;
  if (name.includes('command-r')) return 131072;
  if (name.includes('yi')) return 131072;
  // Default for unknown models
  return DEFAULT_CONTEXT;
}

interface OllamaMessage {
  role: string;
  content: string;
  tool_calls?: Array<{ function: { name: string; arguments: Record<string, unknown> } }>;
}

export class OllamaProvider implements LLMProvider {
  readonly name = 'ollama' as const;
  private url: string;
  private timeout: number;

  constructor(url = DEFAULT_URL, timeout = DEFAULT_TIMEOUT) {
    this.url = url;
    this.timeout = timeout;
  }

  async checkHealth(): Promise<boolean> {
    try {
      const response = await fetch(`${this.url}/api/tags`, {
        method: 'GET',
        signal: AbortSignal.timeout(5000),
      });
      return response.ok;
    } catch {
      return false;
    }
  }

  async getAvailableModels(): Promise<ModelInfo[]> {
    try {
      const response = await fetch(`${this.url}/api/tags`, {
        method: 'GET',
        signal: AbortSignal.timeout(10000),
      });
      if (!response.ok) return [];
      const data = (await response.json()) as {
        models?: Array<{ name: string; modified_at: string; size: number }>;
      };
      return (data.models || []).map((m) => ({
        name: m.name,
        provider: 'ollama',
        size: m.size,
        modified_at: m.modified_at,
      }));
    } catch {
      return [];
    }
  }

  async getModelContextLength(modelName: string): Promise<number> {
    try {
      const response = await fetch(`${this.url}/api/show`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: modelName }),
        signal: AbortSignal.timeout(10000),
      });
      if (!response.ok) return guessContextLength(modelName);
      const data = (await response.json()) as {
        parameters?: string;
        modelfile?: string;
        model_info?: Record<string, unknown>;
      };

      // Check parameters string for num_ctx
      const params = data.parameters || '';
      const match = params.match(/num_ctx\s+(\d+)/);
      if (match) return parseInt(match[1], 10);

      // Check modelfile for num_ctx
      const modelfile = data.modelfile || '';
      const ctxMatch = modelfile.match(/num_ctx\s+(\d+)/);
      if (ctxMatch) return parseInt(ctxMatch[1], 10);

      // Check model_info for context_length (newer Ollama versions)
      const modelInfo = data.model_info;
      if (modelInfo) {
        const ctxKey = Object.keys(modelInfo).find((k) => k.includes('context_length'));
        if (ctxKey && typeof modelInfo[ctxKey] === 'number') {
          return modelInfo[ctxKey] as number;
        }
      }

      return guessContextLength(modelName);
    } catch {
      return guessContextLength(modelName);
    }
  }

  formatTools(tools: ToolDefinition[]): object[] {
    return tools.map((tool) => ({
      type: 'function',
      function: {
        name: tool.name,
        description: tool.description,
        parameters: tool.parameters,
      },
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
    const ollamaMessages: OllamaMessage[] = [
      { role: 'system', content: systemPrompt },
    ];

    for (const m of messages) {
      if (m.role === 'tool') {
        ollamaMessages.push({ role: 'tool', content: m.content });
      } else if (m.role === 'assistant' && m.toolCalls && m.toolCalls.length > 0) {
        ollamaMessages.push({
          role: 'assistant',
          content: m.content,
          tool_calls: m.toolCalls.map((tc) => ({
            function: { name: tc.name, arguments: tc.arguments },
          })),
        });
      } else {
        ollamaMessages.push({ role: m.role, content: m.content });
      }
    }

    const body: Record<string, unknown> = {
      model,
      messages: ollamaMessages,
      stream: true,
      think: true,
    };

    if (tools && tools.length > 0) {
      body.tools = this.formatTools(tools);
    }

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeout);

    if (abortSignal) {
      abortSignal.addEventListener('abort', () => controller.abort());
    }

    const response = await fetch(`${this.url}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: controller.signal,
    });

    clearTimeout(timeoutId);

    if (!response.ok) {
      throw new Error(`Ollama API returned ${response.status}`);
    }

    const reader = response.body?.getReader();
    if (!reader) {
      throw new Error('No response body from Ollama');
    }

    const decoder = new TextDecoder();
    let buffer = '';
    let fullContent = '';
    let fullThinking = '';
    let promptTokens = 0;
    let responseTokens = 0;
    let toolCalls: Array<{ name: string; arguments: Record<string, unknown> }> = [];

    let batchBuffer = '';
    let batchTimer: NodeJS.Timeout | null = null;
    const BATCH_DELAY = 10;

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');

        for (let i = 0; i < lines.length - 1; i++) {
          const line = lines[i].trim();
          if (!line) continue;

          try {
            const json = JSON.parse(line);

            if (json.message?.thinking) {
              fullThinking += json.message.thinking;
              onThinkingChunk?.(json.message.thinking);
            }

            if (json.message?.content) {
              fullContent += json.message.content;
              batchBuffer += json.message.content;

              if (batchTimer) clearTimeout(batchTimer);
              batchTimer = setTimeout(() => {
                if (batchBuffer) {
                  onChunk(batchBuffer);
                  batchBuffer = '';
                }
              }, BATCH_DELAY);
            }

            if (json.message?.tool_calls) {
              for (const tc of json.message.tool_calls) {
                if (tc.function) {
                  let args = tc.function.arguments;
                  if (typeof args === 'string') {
                    try { args = JSON.parse(args); } catch { args = {}; }
                  }
                  toolCalls.push({ name: tc.function.name, arguments: args || {} });
                }
              }
            }

            if (json.done) {
              promptTokens = json.prompt_eval_count || 0;
              responseTokens = json.eval_count || 0;
            }
          } catch {
            // Skip invalid JSON
          }
        }

        buffer = lines[lines.length - 1];
      }

      if (batchTimer) {
        clearTimeout(batchTimer);
        if (batchBuffer) onChunk(batchBuffer);
      }

      if (buffer.trim()) {
        try {
          const json = JSON.parse(buffer);
          if (json.message?.thinking) {
            fullThinking += json.message.thinking;
            onThinkingChunk?.(json.message.thinking);
          }
          if (json.message?.content) {
            fullContent += json.message.content;
            onChunk(json.message.content);
          }
          if (json.message?.tool_calls) {
            for (const tc of json.message.tool_calls) {
              if (tc.function) {
                let args = tc.function.arguments;
                if (typeof args === 'string') {
                  try { args = JSON.parse(args); } catch { args = {}; }
                }
                toolCalls.push({ name: tc.function.name, arguments: args || {} });
              }
            }
          }
          if (json.done) {
            promptTokens = json.prompt_eval_count || 0;
            responseTokens = json.eval_count || 0;
          }
        } catch {
          // Skip
        }
      }
    } catch (error) {
      if (batchTimer) clearTimeout(batchTimer);
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
}
