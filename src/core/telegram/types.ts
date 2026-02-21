export interface TelegramConfig {
  botToken: string;
  enabled: boolean;
  allowedUserIds: number[]; // Telegram user IDs allowed to use the bot
  voiceEnabled: boolean;    // Whether to send responses as voice
}

export const DEFAULT_TELEGRAM_CONFIG: TelegramConfig = {
  botToken: '',
  enabled: false,
  allowedUserIds: [],
  voiceEnabled: false,
};
