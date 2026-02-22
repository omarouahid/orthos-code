import React from 'react';
import { Box, Text } from 'ink';
import type { ProviderType } from '../types/index.js';

interface StatusBarProps {
  model: string;
  tokenCount: number;
  contextLimit: number;
  yolo?: boolean;
  planProgress?: string;
  isStreaming?: boolean;
  provider?: ProviderType;
  agentMode?: boolean;
  adminMode?: boolean;
  browserConnected?: boolean;
  telegramRunning?: boolean;
  /** Current step label e.g. "Step 3", "Calling model..." */
  stepStatus?: string;
  /** When set, shown as "Running: ..." */
  activeToolName?: string;
}

function providerLabel(type?: ProviderType): string {
  switch (type) {
    case 'anthropic': return 'claude';
    case 'openrouter': return 'openrouter';
    case 'deepseek': return 'deepseek';
    case 'ollama': return 'ollama';
    default: return 'ollama';
  }
}

export function StatusBar({ model, tokenCount, contextLimit, yolo, planProgress, isStreaming, provider, agentMode, adminMode, browserConnected, telegramRunning, stepStatus, activeToolName }: StatusBarProps) {
  const pct = contextLimit > 0 ? Math.round((tokenCount / contextLimit) * 100) : 0;
  const tokenColor = pct > 80 ? 'red' : pct > 50 ? 'yellow' : 'green';
  const width = process.stdout.columns || 60;
  const actionLine = activeToolName ? `Running: ${activeToolName}` : stepStatus || '';

  return (
    <Box flexDirection="column" width={Math.min(width, 120)}>
      {actionLine ? (
        <Box paddingX={2} marginBottom={0}>
          <Text dimColor>{actionLine}</Text>
        </Box>
      ) : null}
      <Box paddingX={2} marginTop={0} justifyContent="space-between" width={Math.min(width, 120)}>
      <Box gap={2}>
        {provider && provider !== 'ollama' && (
          <Text>
            <Text dimColor>{providerLabel(provider)}</Text>
          </Text>
        )}
        {model && (
          <Text>
            <Text dimColor>model:</Text>
            <Text bold color="cyan"> {model}</Text>
          </Text>
        )}
        <Text>
          <Text dimColor>tokens:</Text>
          <Text bold color={tokenColor}> ~{tokenCount}</Text>
          <Text dimColor>/{contextLimit}</Text>
        </Text>
        {adminMode && (
          <Text color="red" bold>ADMIN</Text>
        )}
        {yolo && !adminMode && (
          <Text color="yellow" bold>YOLO</Text>
        )}
        {browserConnected && (
          <Text color="green" bold>BROWSER</Text>
        )}
        {telegramRunning && (
          <Text color="blue" bold>TELEGRAM</Text>
        )}
        {agentMode && (
          <Text color="magenta" bold>AGENT</Text>
        )}
        {isStreaming && (
          <Text color="yellow" dimColor>*</Text>
        )}
        {planProgress && (
          <Text>
            <Text dimColor>step:</Text>
            <Text bold color="cyan"> {planProgress}</Text>
          </Text>
        )}
      </Box>
      <Text dimColor>/help for commands</Text>
    </Box>
    </Box>
  );
}
