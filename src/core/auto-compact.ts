import type { Message, AppConfig, Plan } from '../types/index.js';
import type { LLMProvider } from './providers/types.js';
import { countMessageTokens } from './token-counter.js';

const COMPACT_SYSTEM_PROMPT = `Summarize the following conversation concisely. Preserve:
- Key decisions and conclusions
- Code snippets that were discussed or created
- File paths and project details mentioned
- Any unresolved questions or tasks
- If there is an active step-by-step plan, note its title and each step with status (pending, in progress, completed, failed) so the assistant can continue
- What the user or assistant should do next (so the conversation can continue naturally)
Keep the summary under 500 tokens. Use bullet points for clarity.`;

export function shouldCompact(messages: Message[], config: AppConfig): boolean {
  if (!config.autoCompact) return false;
  if (messages.length <= config.keepRecentMessages + 2) return false;

  const tokenCount = countMessageTokens(messages);
  const threshold = config.contextWindowSize * config.thresholdPercent;
  return tokenCount > threshold;
}

function formatPlanForSummary(plan: Plan): string {
  const lines = plan.steps.map((s) => {
    const icon = s.status === 'completed' ? '✓' : s.status === 'failed' ? '✗' : s.status === 'in_progress' ? '●' : '○';
    return `- ${icon} ${s.title} (${s.status})`;
  });
  return `**Active plan (continue this):** ${plan.title}\n${lines.join('\n')}`;
}

export async function compactMessages(
  messages: Message[],
  model: string,
  config: AppConfig,
  provider: LLMProvider,
  currentPlan?: Plan | null
): Promise<{ messages: Message[]; summary: string } | null> {
  if (messages.length <= config.keepRecentMessages) return null;

  const oldMessages = messages.slice(0, -config.keepRecentMessages);
  const recentMessages = messages.slice(-config.keepRecentMessages);

  // Build the conversation text for summarization
  const conversationText = oldMessages
    .map((m) => `${m.role === 'user' ? 'User' : 'Assistant'}: ${m.content}`)
    .join('\n\n');

  const summaryMessages: Message[] = [
    {
      id: 'compact-request',
      role: 'user',
      content: `Please summarize this conversation:\n\n${conversationText}`,
      timestamp: Date.now(),
    },
  ];

  let summary = '';

  try {
    const result = await provider.streamChat(
      model,
      summaryMessages,
      COMPACT_SYSTEM_PROMPT,
      (chunk) => {
        summary += chunk;
      },
      undefined,
      config.ollamaTimeout
    );
    summary = result.content;
  } catch {
    // If summarization fails, keep a clear placeholder so the model can continue
    summary = `[Older conversation (${oldMessages.length} messages) was compacted. Summarization failed, so only this placeholder is shown. Continue from the recent messages below.]`;
  }

  let summaryContent = `**[Conversation Summary]**\n\n${summary}`;
  if (currentPlan && currentPlan.steps.length > 0) {
    summaryContent += `\n\n${formatPlanForSummary(currentPlan)}`;
  }

  const summaryMessage: Message = {
    id: `compact-${Date.now()}`,
    role: 'assistant',
    content: summaryContent,
    timestamp: Date.now(),
    isCompactSummary: true,
  };

  return {
    messages: [summaryMessage, ...recentMessages],
    summary,
  };
}
