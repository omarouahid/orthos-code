import React, { useState, useCallback } from 'react';
import { Box, Text, useInput } from 'ink';
import type { ProviderType } from '../core/providers/types.js';

const PROVIDER_LABELS: Record<ProviderType, string> = {
  ollama: 'Ollama',
  anthropic: 'Anthropic',
  openrouter: 'OpenRouter',
  deepseek: 'DeepSeek',
};

interface ApiKeyPromptProps {
  provider: ProviderType;
  onSubmit: (apiKey: string) => void;
  onCancel: () => void;
}

export function ApiKeyPrompt({ provider, onSubmit, onCancel }: ApiKeyPromptProps) {
  const [value, setValue] = useState('');

  useInput(
    useCallback(
      (input: string, key) => {
        if (key.escape) {
          onCancel();
          return;
        }
        if (key.return) {
          const trimmed = value.trim();
          if (trimmed) {
            onSubmit(trimmed);
          }
          return;
        }
        if (key.backspace || key.delete) {
          setValue((v) => v.slice(0, -1));
          return;
        }
        // Append typed or pasted input (paste often comes as multi-char)
        if (input && input.length > 0) {
          setValue((v) => v + input);
        }
      },
      [value, onSubmit, onCancel]
    )
  );

  const label = PROVIDER_LABELS[provider] ?? provider;

  return (
    <Box flexDirection="column" paddingX={1}>
      <Text bold color="cyan">
        {label} is not configured.
      </Text>
      <Text dimColor>Paste your API key below (it will be saved), then press Enter.</Text>
      <Box marginTop={1}>
        <Text color="cyan">API key: </Text>
        <Text>{value || ' '}</Text>
      </Box>
      <Text dimColor>Enter confirm  Esc cancel</Text>
    </Box>
  );
}
