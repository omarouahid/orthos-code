import { Bot, InputFile } from 'grammy';
import type { TelegramConfig } from './types.js';
import type { TelegramHandler } from './handler.js';
import { initWhisper, transcribeVoice, synthesizeSpeech, downloadTelegramFile } from './voice.js';

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
        `Send text or voice messages — I have full tool access \\(files, bash, git, web search, browser\\)\\.\n\n` +
        `Commands:\n` +
        `/new \\- Start a fresh conversation\n` +
        `/voice \\- Switch to voice mode \\(spoken responses\\)\n` +
        `/text \\- Switch to text mode \\(markdown responses\\)\n` +
        `/status \\- Show model, provider, and mode\n` +
        `/clear \\- Clear conversation history\n` +
        `/browser \\- Browser connection status\n` +
        `/screenshot \\- Take a browser screenshot`,
        { parse_mode: 'MarkdownV2' },
      );
    });

    // /status command
    this.bot.command('status', async (ctx) => {
      const chatId = ctx.chat.id;
      const browserClient = this.handler.getBrowserClient();
      const browserStatus = browserClient?.isConnected ? 'Connected' : 'Not connected';
      const mode = this.handler.getResponseMode(chatId);
      await ctx.reply(
        `Model: ${escapeMarkdown(this.handler.getModel() || 'unknown')}\n` +
        `Provider: ${escapeMarkdown(this.handler.getConfig()?.provider || 'unknown')}\n` +
        `CWD: ${escapeMarkdown(this.handler.getCwd() || 'unknown')}\n` +
        `Browser: ${browserStatus}\n` +
        `Mode: ${mode}`,
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

    // /new command — start fresh session
    this.bot.command('new', async (ctx) => {
      const chatId = ctx.chat.id;
      this.handler.clearSession(chatId);
      await ctx.reply('New conversation started.');
    });

    // /voice command — switch to voice response mode
    this.bot.command('voice', async (ctx) => {
      const chatId = ctx.chat.id;
      this.handler.setResponseMode(chatId, 'voice');
      await ctx.reply('Switched to voice mode. Responses will be sent as audio.');
    });

    // /text command — switch to text response mode
    this.bot.command('text', async (ctx) => {
      const chatId = ctx.chat.id;
      this.handler.setResponseMode(chatId, 'text');
      await ctx.reply('Switched to text mode. Responses will use markdown formatting.');
    });

    // Handle voice messages
    this.bot.on('message:voice', async (ctx) => {
      const chatId = ctx.chat.id;
      const fileId = ctx.message.voice.file_id;

      await ctx.replyWithChatAction('typing');

      const typingInterval = setInterval(() => {
        ctx.replyWithChatAction('typing').catch(() => {});
      }, 4000);

      try {
        // Download and transcribe voice
        const oggBuffer = await downloadTelegramFile(fileId, this.config.botToken);
        const transcribedText = await transcribeVoice(oggBuffer);

        if (!transcribedText) {
          clearInterval(typingInterval);
          await ctx.reply('Could not transcribe voice message. Please try again.');
          return;
        }

        // Show transcription
        await ctx.reply(`Transcribed: ${transcribedText}`);

        // Process through LLM
        const response = await this.handler.handleMessage(chatId, transcribedText);
        clearInterval(typingInterval);

        if (!response || response.trim() === '') {
          await ctx.reply('(No response generated)');
          return;
        }

        // Send response based on mode
        await this.sendResponse(ctx, chatId, response);
      } catch (err) {
        clearInterval(typingInterval);
        const errorMsg = err instanceof Error ? err.message : 'Unknown error';
        await ctx.reply(`Error: ${errorMsg}`);
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
        const response = await this.handler.handleMessage(chatId, text);

        clearInterval(typingInterval);

        if (!response || response.trim() === '') {
          await ctx.reply('(No response generated)');
          return;
        }

        // Send response based on mode
        await this.sendResponse(ctx, chatId, response);
      } catch (err) {
        clearInterval(typingInterval);
        const errorMsg = err instanceof Error ? err.message : 'Unknown error';
        await ctx.reply(`Error: ${errorMsg}`);
      }
    });
  }

  /**
   * Send a response based on the session's response mode.
   * Voice mode: sends audio + plain text fallback.
   * Text mode: sends markdown-formatted text.
   */
  private async sendResponse(ctx: any, chatId: number, response: string): Promise<void> {
    const mode = this.handler.getResponseMode(chatId);

    if (mode === 'voice') {
      try {
        const audioBuffer = await synthesizeSpeech(response);
        await ctx.replyWithVoice(new InputFile(audioBuffer, 'response.mp3'));
        // Also send plain text so user can read it
        const chunks = splitMessage(response);
        for (const chunk of chunks) {
          await ctx.reply(chunk);
        }
      } catch (err) {
        // If TTS fails, fall back to text
        const chunks = splitMessage(response);
        for (const chunk of chunks) {
          await ctx.reply(chunk);
        }
      }
    } else {
      const chunks = splitMessage(response);
      for (const chunk of chunks) {
        try {
          await ctx.reply(chunk, { parse_mode: 'Markdown' });
        } catch {
          await ctx.reply(chunk);
        }
      }
    }
  }

  async start(): Promise<void> {
    if (this.running) return;
    this.running = true;

    // Pre-load Whisper model so voice messages are fast
    try {
      await initWhisper();
    } catch (err) {
      console.error('[telegram] Failed to load Whisper model:', err instanceof Error ? err.message : err);
      console.error('[telegram] Voice transcription will not be available.');
    }

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
