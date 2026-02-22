import React, { useState, useCallback } from 'react';
import { Box, Text, useInput } from 'ink';
import type { ProviderType } from '../core/providers/types.js';

const PROVIDERS: { id: ProviderType; label: string; desc: string; needsKey: boolean }[] = [
  { id: 'ollama', label: 'Ollama', desc: 'Local models', needsKey: false },
  { id: 'anthropic', label: 'Anthropic', desc: 'Claude API', needsKey: true },
  { id: 'openrouter', label: 'OpenRouter', desc: 'Many models', needsKey: true },
  { id: 'deepseek', label: 'DeepSeek', desc: 'DeepSeek API', needsKey: true },
];

interface ProviderPickerProps {
  currentProvider: ProviderType;
  onSelect: (provider: ProviderType) => void;
  onCancel: () => void;
  /** Which providers have API key/token set (ollama is always ready). */
  providerConfigured?: Partial<Record<ProviderType, boolean>>;
}

export function ProviderPicker({ currentProvider, onSelect, onCancel, providerConfigured }: ProviderPickerProps) {
  const currentIndex = Math.max(0, PROVIDERS.findIndex((p) => p.id === currentProvider));
  const [selectedIndex, setSelectedIndex] = useState(currentIndex);

  useInput(useCallback((_input: string, key) => {
    if (key.escape) {
      onCancel();
      return;
    }
    if (key.return) {
      onSelect(PROVIDERS[selectedIndex].id);
      return;
    }
    if (key.upArrow) {
      setSelectedIndex((i) => Math.max(0, i - 1));
      return;
    }
    if (key.downArrow) {
      setSelectedIndex((i) => Math.min(PROVIDERS.length - 1, i + 1));
    }
  }, [selectedIndex, onSelect, onCancel]));

  return (
    <Box flexDirection="column" paddingX={1}>
      <Text bold color="cyan">Select provider:</Text>
      <Box flexDirection="column" marginTop={0}>
        {PROVIDERS.map((p, i) => {
          const configured = p.id === 'ollama' || (providerConfigured && providerConfigured[p.id]);
          const status = p.needsKey && providerConfigured
            ? (configured ? ' (configured)' : ' (not set — use /setup ' + p.id + ')')
            : '';
          return (
            <Box key={p.id}>
              <Text color={i === selectedIndex ? 'cyan' : undefined} bold={i === selectedIndex}>
                {i === selectedIndex ? '> ' : '  '}
              </Text>
              <Text color={i === selectedIndex ? 'cyan' : undefined} bold={i === selectedIndex}>
                {p.label}
              </Text>
              <Text dimColor> — {p.desc}{status}</Text>
              {p.id === currentProvider && i !== selectedIndex ? (
                <Text dimColor> (current)</Text>
              ) : null}
            </Box>
          );
        })}
      </Box>
      <Text dimColor>↑↓ navigate  Enter select  Esc cancel</Text>
      <Text dimColor>To set API key: /setup {'<provider>'}  e.g. /setup anthropic {'<token>'}</Text>
    </Box>
  );
}
