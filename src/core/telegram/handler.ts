import type { Message } from '../../types/index.js';
import type { ToolResult } from '../tools/types.js';
import type { LLMProvider } from '../providers/types.js';
import type { AppConfig } from '../../types/index.js';
import type { BrowserClient } from '../browser/client.js';
import { executeTool, formatToolCall, getActiveTools } from '../tools/index.js';
import { executeBrowser } from '../tools/browser.js';
import { executeJira } from '../tools/jira.js';
import { buildSystemPrompt } from '../../cli/constants.js';

const MAX_TOOL_ITERATIONS = 30;
const SESSION_TTL_MS = 60 * 60 * 1000; // 1 hour idle timeout
const SESSION_CLEANUP_INTERVAL_MS = 10 * 60 * 1000; // Check every 10 minutes

interface ChatSession {
  messages: Message[];
  lastActive: number;
}

export class TelegramHandler {
  private sessions: Map<number, ChatSession> = new Map();
  private provider: LLMProvider;
  private config: AppConfig;
  private model: string;
  private cwd: string;
  private projectContext: string;
  private browserClient: BrowserClient | null = null;
  private msgCounter = 0;
  private cleanupTimer: ReturnType<typeof setInterval> | null = null;

  constructor(opts: {
    provider: LLMProvider;
    config: AppConfig;
    model: string;
    cwd: string;
    projectContext: string;
  }) {
    this.provider = opts.provider;
    this.config = opts.config;
    this.model = opts.model;
    this.cwd = opts.cwd;
    this.projectContext = opts.projectContext;

    // Periodic cleanup of idle sessions
    this.cleanupTimer = setInterval(() => this.cleanupIdleSessions(), SESSION_CLEANUP_INTERVAL_MS);
  }

  /** Getters for bot.ts to read handler state */
  getModel(): string { return this.model; }
  getConfig(): AppConfig { return this.config; }
  getCwd(): string { return this.cwd; }
  getBrowserClient(): BrowserClient | null { return this.browserClient; }

  setProvider(provider: LLMProvider) { this.provider = provider; }
  setModel(model: string) { this.model = model; }
  setBrowserClient(client: BrowserClient | null) { this.browserClient = client; }

  /** Stop the cleanup timer (call when stopping the bot) */
  destroy(): void {
    if (this.cleanupTimer) {
      clearInterval(this.cleanupTimer);
      this.cleanupTimer = null;
    }
    this.sessions.clear();
  }

  /** Remove sessions that have been idle for longer than SESSION_TTL_MS */
  private cleanupIdleSessions(): void {
    const now = Date.now();
    for (const [chatId, session] of this.sessions) {
      if (now - session.lastActive > SESSION_TTL_MS) {
        this.sessions.delete(chatId);
      }
    }
  }

  private nextId(): string {
    return `tg-msg-${Date.now()}-${++this.msgCounter}`;
  }

  private getSession(chatId: number): ChatSession {
    let session = this.sessions.get(chatId);
    if (!session) {
      session = { messages: [], lastActive: Date.now() };
      this.sessions.set(chatId, session);
    }
    session.lastActive = Date.now();
    return session;
  }

  clearSession(chatId: number): void {
    this.sessions.delete(chatId);
  }

  /**
   * Process a user message through the full LLM + tool loop.
   * Returns the final assistant response text.
   * onProgress is called with partial output for long operations.
   */
  async handleMessage(
    chatId: number,
    userText: string,
    onProgress?: (text: string) => void,
  ): Promise<string> {
    const session = this.getSession(chatId);

    const userMessage: Message = {
      id: this.nextId(),
      role: 'user',
      content: userText,
      timestamp: Date.now(),
    };
    session.messages.push(userMessage);

    // Trim old messages to keep context manageable (keep last 40)
    if (session.messages.length > 40) {
      session.messages = session.messages.slice(-40);
    }

    const browserUp = this.browserClient?.isConnected ?? false;
    // Always include browser tool in the tool list so the LLM knows it exists.
    // If not connected, executeBrowser returns a clear error guiding the user to connect.
    const tools = getActiveTools(false, true);
    const browserNote = browserUp
      ? '\n\nThe browser extension IS connected and ready. You can navigate, click, type, screenshot, and interact with the user\'s Chrome browser.'
      : '\n\nNote: The browser extension is NOT currently connected. If the user asks to browse, still attempt the browser tool — the error will guide them to connect. You can also tell them to run `/browser` here or `/browser start` in the Orthos CLI.';
    const systemPrompt = buildSystemPrompt(this.cwd, this.projectContext, this.config.provider, true) +
      '\n\nYou are responding via Telegram. Keep responses concise and use Telegram-compatible markdown (bold: *text*, italic: _text_, code: `code`, pre: ```code```). Do not use headers (#) as Telegram does not support them.' +
      browserNote;

    let loopMessages = [...session.messages];
    let finalContent = '';
    let iteration = 0;

    while (iteration < MAX_TOOL_ITERATIONS) {
      iteration++;

      let accumulatedContent = '';
      const result = await this.provider.streamChat(
        this.model,
        loopMessages,
        systemPrompt,
        (chunk) => { accumulatedContent += chunk; },
        undefined,
        this.config.ollamaTimeout,
        tools,
      );

      if (!result.toolCalls || result.toolCalls.length === 0) {
        finalContent = result.content;
        const assistantMsg: Message = {
          id: this.nextId(),
          role: 'assistant',
          content: result.content,
          timestamp: Date.now(),
        };
        session.messages.push(assistantMsg);
        break;
      }

      // Execute tool calls
      const toolResults: ToolResult[] = [];
      for (const tc of result.toolCalls) {
        if (onProgress) {
          onProgress(`Running: ${formatToolCall(tc.name, tc.arguments)}`);
        }

        if (tc.name === 'browser') {
          const toolResult = await executeBrowser(tc.arguments, this.browserClient);
          toolResults.push(toolResult);
          continue;
        }

        if (tc.name === 'jira') {
          const toolResult = await executeJira(tc.arguments);
          toolResults.push(toolResult);
          continue;
        }

        // Skip permission check for Telegram (runs with full access like admin mode)
        const toolResult = executeTool(tc.name, tc.arguments, this.cwd);
        toolResults.push(toolResult);
      }

      // Add assistant + tool messages to conversation
      const assistantToolMsg: Message = {
        id: this.nextId(),
        role: 'assistant',
        content: result.content,
        timestamp: Date.now(),
        toolCalls: result.toolCalls,
        toolResults,
      };
      loopMessages.push(assistantToolMsg);
      session.messages.push(assistantToolMsg);

      for (let i = 0; i < result.toolCalls.length; i++) {
        const toolMsg: Message = {
          id: this.nextId(),
          role: 'tool',
          content: JSON.stringify({
            name: result.toolCalls[i].name,
            result: toolResults[i]?.output || 'No result',
            success: toolResults[i]?.success ?? false,
          }),
          timestamp: Date.now(),
        };
        loopMessages.push(toolMsg);
        session.messages.push(toolMsg);
      }
    }

    return finalContent;
  }
}
