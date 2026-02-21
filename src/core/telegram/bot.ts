import { Bot, InputFile } from 'grammy';
import type { TelegramConfig } from './types.js';
import type { TelegramHandler } from './handler.js';

const MAX_MESSAGE_LENGTH = 4000; // Telegram limit is 4096, leave margin

export class TelegramBot {
  private bot: Bot;
  private handler: TelegramHandler;
  private config: TelegramConfig;
  private running = false;

  constructor(config: TelegramConfig, handler: TelegramHandler) {
    this.config = config;
    this.handler = handler;
    this.bot = new Bot(config.botToken);
    this.setupHandlers();
  }

  private setupHandlers(): void {
    // Access control middleware
    this.bot.use(async (ctx, next) => {
      if (this.config.allowedUserIds.length > 0) {
        const userId = ctx.from?.id;
        if (!userId || !this.config.allowedUserIds.includes(userId)) {
          await ctx.reply('Access denied. Your user ID is not authorized.');
          return;
        }
      }
      await next();
    });

    // /start command
    this.bot.command('start', async (ctx) => {
      const userId = ctx.from?.id || 'unknown';
      await ctx.reply(
        `*Orthos Code* is ready\\!\n\n` +
        `Your Telegram user ID: \`${userId}\`\n\n` +
        `Send any message and I'll process it with full tool access \\(file operations, bash, git, web search, browser control\\)\\.\n\n` +
        `Commands:\n` +
        `/status \\- Show current model and provider\n` +
        `/clear \\- Clear conversation history\n` +
        `/browser \\- Check browser connection status\n` +
        `/screenshot \\- Take a browser screenshot`,
        { parse_mode: 'MarkdownV2' },
      );
    });

    // /status command
    this.bot.command('status', async (ctx) => {
      const browserClient = this.handler.getBrowserClient();
      const browserStatus = browserClient?.isConnected ? 'Connected' : 'Not connected';
      await ctx.reply(
        `Model: ${escapeMarkdown(this.handler.getModel() || 'unknown')}\n` +
        `Provider: ${escapeMarkdown(this.handler.getConfig()?.provider || 'unknown')}\n` +
        `CWD: ${escapeMarkdown(this.handler.getCwd() || 'unknown')}\n` +
        `Browser: ${browserStatus}`,
      );
    });

    // /clear command
    this.bot.command('clear', async (ctx) => {
      const chatId = ctx.chat.id;
      this.handler.clearSession(chatId);
      await ctx.reply('Conversation cleared.');
    });

    // /browser command — check status and give setup instructions
    this.bot.command('browser', async (ctx) => {
      const browserClient = this.handler.getBrowserClient();
      const connected = browserClient?.isConnected ?? false;
      if (connected) {
        await ctx.reply('Browser extension is connected and ready.\n\nYou can ask me to browse websites, click buttons, fill forms, take screenshots, and more.');
      } else {
        await ctx.reply(
          'Browser extension is NOT connected.\n\n' +
          'To set up browser control:\n' +
          '1. In the Orthos CLI, run: /browser start\n' +
          '2. Open Chrome → chrome://extensions/\n' +
          '3. Enable Developer mode\n' +
          '4. Click "Load unpacked" → select the extension/ folder\n' +
          '5. Click the Orthos extension icon → paste the auth token → Connect\n\n' +
          'Once connected, you can ask me to browse any website from here.'
        );
      }
    });

    // /screenshot command
    this.bot.command('screenshot', async (ctx) => {
      const browserClient = this.handler.getBrowserClient();
      if (!browserClient || !browserClient.isConnected) {
        await ctx.reply('Browser extension not connected. Start it with /browser in the CLI.');
        return;
      }
      try {
        const response = await browserClient.screenshot();
        if (response.success && response.data?.base64) {
          const buffer = Buffer.from(response.data.base64 as string, 'base64');
          await ctx.replyWithPhoto(new InputFile(buffer, 'screenshot.png'));
        } else {
          await ctx.reply('Failed to take screenshot.');
        }
      } catch (err) {
        await ctx.reply(`Screenshot error: ${err instanceof Error ? err.message : 'unknown'}`);
      }
    });

    // Handle all text messages
    this.bot.on('message:text', async (ctx) => {
      const chatId = ctx.chat.id;
      const text = ctx.message.text;

      // Show "typing..." indicator
      await ctx.replyWithChatAction('typing');

      // Set up periodic typing indicator for long operations
      const typingInterval = setInterval(() => {
        ctx.replyWithChatAction('typing').catch(() => {});
      }, 4000);

      try {
        const response = await this.handler.handleMessage(chatId, text, async (progress) => {
          // Optionally send progress updates for long tool operations
          // (only for very long operations to avoid spam)
        });

        clearInterval(typingInterval);

        if (!response || response.trim() === '') {
          await ctx.reply('(No response generated)');
          return;
        }

        // Split long messages
        const chunks = splitMessage(response);
        for (const chunk of chunks) {
          try {
            await ctx.reply(chunk, { parse_mode: 'Markdown' });
          } catch {
            // Fallback: send without markdown if parsing fails
            await ctx.reply(chunk);
          }
        }
      } catch (err) {
        clearInterval(typingInterval);
        const errorMsg = err instanceof Error ? err.message : 'Unknown error';
        await ctx.reply(`Error: ${errorMsg}`);
      }
    });
  }

  async start(): Promise<void> {
    if (this.running) return;
    this.running = true;
    // Use long polling (simpler than webhooks for a CLI tool)
    this.bot.start({
      onStart: () => {
        // Bot started successfully
      },
    });
  }

  async stop(): Promise<void> {
    if (!this.running) return;
    this.running = false;
    this.bot.stop();
    this.handler.destroy();
  }

  get isRunning(): boolean {
    return this.running;
  }
}

function splitMessage(text: string): string[] {
  if (text.length <= MAX_MESSAGE_LENGTH) return [text];

  const chunks: string[] = [];
  let remaining = text;

  while (remaining.length > 0) {
    if (remaining.length <= MAX_MESSAGE_LENGTH) {
      chunks.push(remaining);
      break;
    }

    // Try to split at a newline
    let splitIdx = remaining.lastIndexOf('\n', MAX_MESSAGE_LENGTH);
    if (splitIdx < MAX_MESSAGE_LENGTH * 0.3) {
      // No good newline — split at space
      splitIdx = remaining.lastIndexOf(' ', MAX_MESSAGE_LENGTH);
    }
    if (splitIdx < MAX_MESSAGE_LENGTH * 0.3) {
      // No good split point — hard cut
      splitIdx = MAX_MESSAGE_LENGTH;
    }

    chunks.push(remaining.slice(0, splitIdx));
    remaining = remaining.slice(splitIdx).trimStart();
  }

  return chunks;
}

function escapeMarkdown(text: string): string {
  return text.replace(/[_*[\]()~`>#+\-=|{}.!\\]/g, '\\$&');
}
