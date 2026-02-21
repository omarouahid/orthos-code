import React, { useMemo } from 'react';
import { Box, Static, Text } from 'ink';
import { Spinner } from '@inkjs/ui';
import { Message as MessageComponent } from './message.js';
import { WelcomeBanner } from './welcome.js';
import type { Message } from '../types/index.js';

// Stable marker for the header — must be a module-level constant so Static
// recognises it as "already rendered" on subsequent renders.
const HEADER_MARKER = { id: 'orthos-header' } as const;

type StaticItem = typeof HEADER_MARKER | Message;

interface MessageListProps {
  messages: Message[];
  streamingContent: string;
  streamingThinking?: string;
  isStreaming: boolean;
  activeToolName?: string;
  model: string;
  cwd: string;
  yolo?: boolean;
  setSelectedMessageId?: (id: string | null) => void;
  onViewDiff?: (messageId: string) => void;
}

const noopSetSelected = (_id: string | null) => {};

export function MessageList({ messages, streamingContent, streamingThinking, isStreaming, activeToolName, model, cwd, yolo, setSelectedMessageId = noopSetSelected, onViewDiff }: MessageListProps) {
  // Header is the first Static item — it renders once at the top and stays there.
  // Messages are appended after it. Static only renders NEW items.
  const staticItems: StaticItem[] = useMemo(
    () => [HEADER_MARKER as StaticItem, ...messages.filter((m) => m.role !== 'tool')],
    [messages]
  );

  return (
    <Box flexDirection="column">
      <Static items={staticItems}>
        {(item) => {
          // Render the banner header as the very first item
          if (item === HEADER_MARKER) {
            return (
              <Box key="orthos-header" flexDirection="column">
                <WelcomeBanner model={model} cwd={cwd} yolo={yolo} />
              </Box>
            );
          }

          const msg = item as Message;
          return (
            <Box key={msg.id} flexDirection="column">
              <MessageComponent
                role={msg.role}
                content={msg.content}
                attachments={msg.attachments}
                isCompactSummary={msg.isCompactSummary}
                toolCalls={msg.toolCalls}
                toolResults={msg.toolResults}
                thinking={msg.thinking}
                plan={msg.plan}
                setSelectedMessageId={setSelectedMessageId}
                onViewDiff={onViewDiff}
                messageId={msg.id}
              />
              {msg.role === 'assistant' && (
                <Box paddingX={2}>
                  <Text dimColor>{'─'.repeat(Math.min(process.stdout.columns - 4 || 56, 60))}</Text>
                </Box>
              )}
            </Box>
          );
        }}
      </Static>

      {/* Live streaming thinking (models that support reasoning trace) */}
      {isStreaming && streamingThinking && (
        <Box flexDirection="column" paddingX={2} marginY={0}>
          <Box borderStyle="round" borderColor="gray" paddingX={1}>
            <Box flexDirection="column">
              <Box>
                <Spinner type="dots" />
                <Text dimColor bold> {'💭'} Thinking</Text>
              </Box>
              <Box paddingLeft={0}>
                <Text dimColor>{streamingThinking}</Text>
              </Box>
            </Box>
          </Box>
        </Box>
      )}

      {/* Streaming assistant response (thinking shown above when present) */}
      {isStreaming && streamingContent && (
        <Box flexDirection="column">
          <MessageComponent
            role="assistant"
            content={streamingContent}
            isStreaming={true}
          />
        </Box>
      )}

      {/* Processing indicator when waiting for first token (no content yet) */}
      {isStreaming && !streamingContent && !streamingThinking && (
        <Box paddingX={2} marginY={0}>
          <Box>
            <Spinner type="dots" />
            <Text bold color="cyan"> {'⚡'} </Text>
            {activeToolName ? (
              <Box>
                <Text color="yellow">Running </Text>
                <Text bold>{activeToolName}</Text>
                <Text dimColor>...</Text>
              </Box>
            ) : (
              <Box>
                <Text dimColor>Processing</Text>
                <Text color="yellow"> ...</Text>
              </Box>
            )}
          </Box>
        </Box>
      )}
    </Box>
  );
}
