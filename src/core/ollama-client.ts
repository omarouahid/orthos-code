import type { Message, OllamaModel, StreamResult } from '../types/index.js';

const DEFAULT_URL = 'http://localhost:11434';
const DEFAULT_TIMEOUT = 120000;

export async function checkOllamaHealth(ollamaUrl = DEFAULT_URL): Promise<boolean> {
  try {
    const response = await fetch(`${ollamaUrl}/api/tags`, {
      method: 'GET',
      signal: AbortSignal.timeout(5000),
    });
    return response.ok;
  } catch {
    return false;
  }
}

export async function getAvailableModels(ollamaUrl = DEFAULT_URL): Promise<OllamaModel[]> {
  try {
    const response = await fetch(`${ollamaUrl}/api/tags`, {
      method: 'GET',
      signal: AbortSignal.timeout(10000),
    });
    if (!response.ok) return [];
    const data = await response.json() as { models?: OllamaModel[] };
    return data.models || [];
  } catch {
    return [];
  }
}

export async function getModelContextLength(ollamaUrl: string, modelName: string): Promise<number> {
  try {
    const response = await fetch(`${ollamaUrl}/api/show`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: modelName }),
      signal: AbortSignal.timeout(10000),
    });
    if (!response.ok) return 8192;
    const data = await response.json() as { parameters?: string; modelfile?: string };
    const params = data.parameters || '';
    const match = params.match(/num_ctx\s+(\d+)/);
    if (match) return parseInt(match[1], 10);
    const modelfile = data.modelfile || '';
    const ctxMatch = modelfile.match(/num_ctx\s+(\d+)/);
    if (ctxMatch) return parseInt(ctxMatch[1], 10);
    return 8192;
  } catch {
    return 8192;
  }
}

interface OllamaMessage {
  role: string;
  content: string;
  tool_calls?: Array<{ function: { name: string; arguments: Record<string, unknown> } }>;
}

export async function streamChat(
  ollamaUrl: string,
  model: string,
  messages: Message[],
  systemPrompt: string,
  onChunk: (chunk: string) => void,
  abortSignal?: AbortSignal,
  timeout = DEFAULT_TIMEOUT,
  tools?: object[],
  onThinkingChunk?: (chunk: string) => void
): Promise<StreamResult> {
  // Build Ollama messages - handle tool role messages
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
    think: true, // Enable reasoning trace for thinking-capable models (DeepSeek R1, Qwen 3, etc.)
  };

  if (tools && tools.length > 0) {
    body.tools = tools;
  }

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeout);
  
  // Merge with external abort signal if provided
  if (abortSignal) {
    abortSignal.addEventListener('abort', () => controller.abort());
  }

  const response = await fetch(`${ollamaUrl}/api/chat`, {
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
  
  // Batch processing variables
  let batchBuffer = '';
  let batchTimer: NodeJS.Timeout | null = null;
  const BATCH_DELAY = 10; // ms

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

          // Handle thinking/reasoning trace (thinking-capable models)
          if (json.message?.thinking) {
            fullThinking += json.message.thinking;
            onThinkingChunk?.(json.message.thinking);
          }

          // Handle text content with batching for smoother UI updates
          if (json.message?.content) {
            fullContent += json.message.content;
            
            // Batch content updates to reduce UI rendering overhead
            batchBuffer += json.message.content;
            
            if (batchTimer) clearTimeout(batchTimer);
            batchTimer = setTimeout(() => {
              if (batchBuffer) {
                onChunk(batchBuffer);
                batchBuffer = '';
              }
            }, BATCH_DELAY);
          }

          // Handle tool calls
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

    // Flush any remaining batched content
    if (batchTimer) {
      clearTimeout(batchTimer);
      if (batchBuffer) {
        onChunk(batchBuffer);
      }
    }

    // Process remaining buffer
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
