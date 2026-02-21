import { useState, useEffect, useCallback } from 'react';
import { Box, Text, useInput } from 'ink';
import type { ModelInfo } from '../types/index.js';
import type { LLMProvider } from '../core/providers/types.js';

interface ModelPickerProps {
  models: ModelInfo[];
  currentModel?: string;
  provider?: LLMProvider;
  onSelect: (model: string) => void;
  onCancel: () => void;
}

function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return Math.round((bytes / Math.pow(k, i)) * 100) / 100 + ' ' + sizes[i];
}

export function ModelPicker({ models: initialModels, currentModel, provider, onSelect, onCancel }: ModelPickerProps) {
  const [models, setModels] = useState<ModelInfo[]>(initialModels);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [loading, setLoading] = useState(false);
  const PAGE_SIZE = 15;

  // Re-fetch models from provider on mount
  useEffect(() => {
    if (!provider) return;
    let cancelled = false;
    setLoading(true);
    provider.getAvailableModels().then((fetched) => {
      if (!cancelled && fetched.length > 0) {
        setModels(fetched);
        // Set initial selection to current model
        if (currentModel) {
          const idx = fetched.findIndex((m) => m.name === currentModel);
          if (idx >= 0) setSelectedIndex(idx);
        }
      }
      setLoading(false);
    }).catch(() => {
      if (!cancelled) setLoading(false);
    });
    return () => { cancelled = true; };
  }, [provider, currentModel]);

  useInput(useCallback((_input: string, key) => {
    if (key.escape) {
      onCancel();
      return;
    }
    if (key.return) {
      if (models.length > 0) {
        onSelect(models[selectedIndex].name);
      }
      return;
    }
    if (key.upArrow || _input === 'k') {
      setSelectedIndex((i) => Math.max(0, i - 1));
      return;
    }
    if (key.downArrow || _input === 'j') {
      setSelectedIndex((i) => Math.min(models.length - 1, i + 1));
      return;
    }
  }, [models, selectedIndex, onSelect, onCancel]));

  if (loading) {
    return (
      <Box paddingX={1}>
        <Text color="cyan">Loading models...</Text>
      </Box>
    );
  }

  if (models.length === 0) {
    return (
      <Box flexDirection="column" paddingX={1}>
        <Text color="yellow">No models available.</Text>
        <Text dimColor>Press Esc to go back.</Text>
      </Box>
    );
  }

  // Calculate visible window (scroll with selection)
  const halfPage = Math.floor(PAGE_SIZE / 2);
  let startIdx = Math.max(0, selectedIndex - halfPage);
  const endIdx = Math.min(models.length, startIdx + PAGE_SIZE);
  if (endIdx - startIdx < PAGE_SIZE && models.length >= PAGE_SIZE) {
    startIdx = Math.max(0, endIdx - PAGE_SIZE);
  }
  const visibleModels = models.slice(startIdx, endIdx);

  return (
    <Box flexDirection="column" paddingX={1}>
      <Text bold color="cyan">Select a model ({models.length} available):</Text>
      <Box flexDirection="column" marginTop={1}>
        {visibleModels.map((m, i) => {
          const realIdx = startIdx + i;
          const isSelected = realIdx === selectedIndex;
          const isCurrent = m.name === currentModel;
          const extra = m.size ? ` (${formatBytes(m.size)})` :
            m.displayName && m.displayName !== m.name ? ` - ${m.displayName}` : '';
          const marker = isCurrent ? ' (active)' : '';

          return (
            <Text key={m.name}>
              <Text color={isSelected ? 'cyan' : undefined} bold={isSelected}>
                {isSelected ? '> ' : '  '}
                {m.name}
              </Text>
              <Text dimColor>{extra}</Text>
              <Text color="green">{marker}</Text>
            </Text>
          );
        })}
      </Box>
      {models.length > PAGE_SIZE && (
        <Text dimColor>
          [{startIdx + 1}-{endIdx} of {models.length}]
        </Text>
      )}
      <Text dimColor>Arrow keys/jk navigate  Enter select  Esc cancel</Text>
    </Box>
  );
}
