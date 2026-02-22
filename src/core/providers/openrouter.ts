import type { Message, StreamResult } from '../../types/index.js';
import type { ToolDefinition } from '../tools/types.js';
import type { LLMProvider, ModelInfo } from './types.js';

const API_BASE = 'https://openrouter.ai/api/v1';
const DEFAULT_TIMEOUT = 120000;

export class OpenRouterProvider implements LLMProvider {
  readonly name = 'openrouter' as const;
  private apiKey: string;
  private timeout: number;

  constructor(apiKey: string, timeout = DEFAULT_TIMEOUT) {
    this.apiKey = apiKey;
    this.timeout = timeout;
  }

  private headers(): Record<string, string> {
    return {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${this.apiKey}`,
      'HTTP-Referer': 'https://github.com/orthos-code',
      'X-Title': 'Orthos Code',
    };
  }

  async checkHealth(): Promise<boolean> {
    try {
      const response = await fetch(`${API_BASE}/models`, {
        method: 'GET',
        headers: this.headers(),
        signal: AbortSignal.timeout(10000),
      });
      return response.ok;
    } catch {
      return false;
    }
  }

  async getAvailableModels(): Promise<ModelInfo[]> {
    try {
      const response = await fetch(`${API_BASE}/models`, {
        method: 'GET',
        headers: this.headers(),
        signal: AbortSignal.timeout(15000),
      });
      if (!response.ok) return [];

      const data = (await response.json()) as {
        data?: Array<{
          id: string;
          name?: string;
          context_length?: number;
          pricing?: { prompt?: string | number; completion?: string | number };
        }>;
      };

      return (data.data || [])
        .filter((m) => m.id && !m.id.includes(':free')) // Filter out free-tier duplicates
        .slice(0, 200)
        .map((m) => {
          const prompt = m.pricing?.prompt;
          const completion = m.pricing?.completion;
          const isFree =
            (typeof prompt === 'string' ? parseFloat(prompt) : Number(prompt)) === 0 &&
            (typeof completion === 'string' ? parseFloat(completion) : Number(completion)) === 0;
          return {
            name: m.id,
            displayName: m.name || m.id,
            provider: 'openrouter',
            contextLength: m.context_length,
            free: isFree,
          };
        });
    } catch {
      return [];
    }
  }

  async getModelContextLength(modelName: string): Promise<number> {
    try {
      const models = await this.getAvailableModels();
      const model = models.find((m) => m.name === modelName);
      return model?.contextLength ?? 128000;
    } catch {
      return 128000;
    }
  }

  formatTools(tools: ToolDefinition[]): object[] {
    // OpenRouter uses OpenAI-compatible tool format
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
    // Convert to OpenAI-compatible message format
    const openaiMessages = this.convertMessages(messages, systemPrompt);

    const body: Record<string, unknown> = {
      model,
      messages: openaiMessages,
      stream: true,
    };

    if (tools && tools.length > 0) {
      body.tools = this.formatTools(tools);
    }

    const controller = new AbortController();
    const timeoutId = timeout > 0 ? setTimeout(() => controller.abort(), timeout) : undefined;
    if (abortSignal) {
      abortSignal.addEventListener('abort', () => controller.abort());
    }

    let fullContent = '';
    let fullThinking = '';
    let promptTokens = 0;
    let responseTokens = 0;
    let toolCalls: Array<{ name: string; arguments: Record<string, unknown> }> = [];

    // Track tool calls being streamed
    const pendingToolCalls = new Map<number, { name: string; args: string }>();

    // Batch content for smoother UI
    let batchBuffer = '';
    let batchTimer: NodeJS.Timeout | null = null;
    const BATCH_DELAY = 10;

    try {
      const response = await fetch(`${API_BASE}/chat/completions`, {
        method: 'POST',
        headers: this.headers(),
        body: JSON.stringify(body),
        signal: controller.signal,
      });

      if (timeoutId !== undefined) clearTimeout(timeoutId);

      if (!response.ok) {
        const errorBody = await response.text().catch(() => '');
        throw new Error(`OpenRouter API returned ${response.status}: ${errorBody}`);
      }

      const reader = response.body?.getReader();
      if (!reader) throw new Error('No response body from OpenRouter');

      const decoder = new TextDecoder();
      let buffer = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');

        for (let i = 0; i < lines.length - 1; i++) {
          const line = lines[i].trim();
          if (!line || line.startsWith(':')) continue;

          if (line.startsWith('data: ')) {
            const data = line.slice(6);
            if (data === '[DONE]') continue;

            try {
              const json = JSON.parse(data);
              const choice = json.choices?.[0];
              if (!choice) continue;

              const delta = choice.delta;

              // Text content
              if (delta?.content) {
                fullContent += delta.content;
                batchBuffer += delta.content;

                if (batchTimer) clearTimeout(batchTimer);
                batchTimer = setTimeout(() => {
                  if (batchBuffer) {
                    onChunk(batchBuffer);
                    batchBuffer = '';
                  }
                }, BATCH_DELAY);
              }

              // Reasoning/thinking (some OpenRouter models support this)
              if (delta?.reasoning) {
                fullThinking += delta.reasoning;
                onThinkingChunk?.(delta.reasoning);
              }

              // Tool calls (streamed incrementally)
              if (delta?.tool_calls) {
                for (const tc of delta.tool_calls) {
                  const idx = tc.index ?? 0;
                  if (!pendingToolCalls.has(idx)) {
                    pendingToolCalls.set(idx, { name: '', args: '' });
                  }
                  const pending = pendingToolCalls.get(idx)!;
                  if (tc.function?.name) {
                    pending.name = tc.function.name;
                  }
                  if (tc.function?.arguments) {
                    pending.args += tc.function.arguments;
                  }
                }
              }

              // Usage info (sometimes in the final chunk)
              if (json.usage) {
                promptTokens = json.usage.prompt_tokens || 0;
                responseTokens = json.usage.completion_tokens || 0;
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

      // Finalize tool calls
      for (const [, pending] of pendingToolCalls) {
        if (pending.name) {
          let args: Record<string, unknown> = {};
          try {
            args = JSON.parse(pending.args || '{}');
          } catch {
            args = {};
          }
          toolCalls.push({ name: pending.name, arguments: args });
        }
      }
    } catch (error) {
      if (batchTimer) clearTimeout(batchTimer);
      if (timeoutId !== undefined) clearTimeout(timeoutId);
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

  /** Convert internal Message[] to OpenAI-compatible format */
  private convertMessages(messages: Message[], systemPrompt: string): object[] {
    const result: object[] = [
      { role: 'system', content: systemPrompt },
    ];

    for (const m of messages) {
      if (m.role === 'system') continue;

      if (m.role === 'tool') {
        // Tool results in OpenAI format
        let toolData: { name?: string; result?: string; success?: boolean } = {};
        try {
          toolData = JSON.parse(m.content);
        } catch {
          toolData = { result: m.content };
        }
        result.push({
          role: 'tool',
          tool_call_id: toolData.name || 'unknown',
          content: toolData.result || m.content,
        });
      } else if (m.role === 'assistant' && m.toolCalls && m.toolCalls.length > 0) {
        result.push({
          role: 'assistant',
          content: m.content || null,
          tool_calls: m.toolCalls.map((tc) => ({
            id: tc.name,
            type: 'function',
            function: {
              name: tc.name,
              arguments: JSON.stringify(tc.arguments),
            },
          })),
        });
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
