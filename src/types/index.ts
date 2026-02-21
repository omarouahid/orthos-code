import type { ToolResult } from '../core/tools/types.js';
import type { ProviderType, ModelInfo } from '../core/providers/types.js';
import type { AgentRole, ExecutionMode } from '../core/orchestrator/types.js';

export type { ProviderType, ModelInfo };
export type { AgentRole, ExecutionMode };

export interface Message {
  id: string;
  role: 'user' | 'assistant' | 'system' | 'tool';
  content: string;
  timestamp: number;
  attachments?: FileAttachment[];
  isCompactSummary?: boolean;
  // Tool-related
  toolCalls?: Array<{ name: string; arguments: Record<string, unknown> }>;
  toolResults?: ToolResult[];
  thinking?: string; // Model's reasoning
  plan?: Plan; // Attached plan for this message
}

export interface FileAttachment {
  path: string;
  absolutePath: string;
  content: string;
  language: string;
  size: number;
}

/** @deprecated Use ModelInfo from providers/types.ts instead */
export interface OllamaModel {
  name: string;
  modified_at: string;
  size: number;
}

export interface StreamResult {
  content: string;
  promptTokens: number;
  responseTokens: number;
  totalTokens: number;
  toolCalls?: Array<{ name: string; arguments: Record<string, unknown> }>;
  /** Reasoning trace from thinking-capable models (e.g. DeepSeek R1, Qwen 3, Claude) */
  thinking?: string;
}

export interface AppConfig {
  // Provider selection
  provider: ProviderType;
  // Ollama settings
  ollamaUrl: string;
  ollamaTimeout: number;
  // Anthropic settings
  anthropicToken: string; // OAuth token from `claude setup-token`
  // OpenRouter settings
  openrouterApiKey: string;
  // DeepSeek settings
  deepseekApiKey: string;
  // General settings
  autoCompact: boolean;
  contextWindowSize: number;
  thresholdPercent: number;
  keepRecentMessages: number;
  maxFileSizeBytes: number;
  maxTotalAttachmentBytes: number;
  yolo: boolean;
  // Browser extension settings
  browserWsPort: number;
  browserAuthToken: string;
  browserEnabled: boolean;
  // Telegram bot settings
  telegramBotToken: string;
  telegramEnabled: boolean;
  telegramAllowedUsers: number[];
  telegramVoiceEnabled: boolean;
}

export interface PlanStep {
  id: number;
  title: string;
  description: string;
  status: 'pending' | 'in_progress' | 'completed' | 'failed';
  duration?: number; // ms, set when completed
  agentRole?: AgentRole;   // Assigned agent role in orchestrator mode
  agentTaskId?: string;    // Links to AgentTask.id for tracking
}

export interface Plan {
  title: string;
  steps: PlanStep[];
  approved: boolean;
  createdAt: number;
  agentMode?: boolean;     // Whether this plan uses agent orchestration
}

export interface ConversationData {
  id: string;
  messages: Message[];
  model: string;
  createdAt: number;
  updatedAt: number;
}
