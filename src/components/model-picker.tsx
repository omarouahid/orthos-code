import { useState, useEffect, useCallback, useMemo } from 'react';
import { Box, Text, useInput } from 'ink';
import type { ModelInfo } from '../types/index.js';
import type { LLMProvider } from '../core/providers/types.js';

interface ModelPickerProps {
  models: ModelInfo[];
  currentModel?: string;
  provider?: LLMProvider;
  /** When provided, used instead of provider.getAvailableModels() (e.g. cached with TTL). */
  fetchModels?: () => Promise<ModelInfo[]>;
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

type OpenRouterFilter = 'all' | 'free';

export function ModelPicker({ models: initialModels, currentModel, provider, fetchModels, onSelect, onCancel }: ModelPickerProps) {
  const [models, setModels] = useState<ModelInfo[]>(initialModels);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [loading, setLoading] = useState(false);
  const [openRouterFilter, setOpenRouterFilter] = useState<OpenRouterFilter | null>(null);
  const [filterChoiceIndex, setFilterChoiceIndex] = useState(0);
  const PAGE_SIZE = 15;

  const isOpenRouter = provider?.name === 'openrouter';
  const showFilterFirst = isOpenRouter && openRouterFilter === null && models.some((m) => m.free !== undefined);

  const filteredModels = useMemo(() => {
    if (!isOpenRouter || openRouterFilter === 'all') return models;
    if (openRouterFilter === 'free') return models.filter((m) => m.free === true);
    return models;
  }, [models, isOpenRouter, openRouterFilter]);

  // Re-fetch models on mount (cached when fetchModels is provided)
  useEffect(() => {
    const load = fetchModels ?? (provider ? () => provider.getAvailableModels() : null);
    if (!load) return;
    let cancelled = false;
    setLoading(true);
    setOpenRouterFilter(null);
    load().then((fetched) => {
      if (!cancelled && fetched.length > 0) {
        setModels(fetched);
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
  }, [provider, currentModel, fetchModels]);

  useInput(useCallback((_input: string, key) => {
    if (key.escape) {
      if (showFilterFirst) {
        onCancel();
        return;
      }
      if (isOpenRouter && openRouterFilter !== null) {
        setOpenRouterFilter(null);
        return;
      }
      onCancel();
      return;
    }
    if (showFilterFirst) {
      if (key.return) {
        setOpenRouterFilter(filterChoiceIndex === 0 ? 'all' : 'free');
        setSelectedIndex(0);
        return;
      }
      if (key.upArrow || key.downArrow) {
        setFilterChoiceIndex((i) => (i === 0 ? 1 : 0));
        return;
      }
      return;
    }
    if (key.return) {
      if (filteredModels.length > 0) {
        const idx = Math.min(selectedIndex, filteredModels.length - 1);
        onSelect(filteredModels[idx].name);
      }
      return;
    }
    if (key.upArrow) {
      setSelectedIndex((i) => Math.max(0, i - 1));
      return;
    }
    if (key.downArrow) {
      setSelectedIndex((i) => Math.min(filteredModels.length - 1, i + 1));
      return;
    }
  }, [showFilterFirst, filterChoiceIndex, filteredModels, selectedIndex, isOpenRouter, openRouterFilter, onSelect, onCancel]));

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

  // OpenRouter: show filter picker first (All vs Free only)
  if (showFilterFirst) {
    const options: { label: string; value: OpenRouterFilter }[] = [
      { label: 'All models', value: 'all' },
      { label: 'Free only', value: 'free' },
    ];
    const freeCount = models.filter((m) => m.free === true).length;
    return (
      <Box flexDirection="column" paddingX={1}>
        <Text bold color="cyan">OpenRouter — show:</Text>
        <Box flexDirection="column" marginTop={1}>
          {options.map((opt, i) => (
            <Text key={opt.value}>
              <Text color={filterChoiceIndex === i ? 'cyan' : undefined} bold={filterChoiceIndex === i}>
                {filterChoiceIndex === i ? '> ' : '  '}
                {opt.label}
                {opt.value === 'free' && freeCount > 0 && (
                  <Text dimColor> ({freeCount})</Text>
                )}
              </Text>
            </Text>
          ))}
        </Box>
        <Text dimColor>Enter select  Esc cancel</Text>
      </Box>
    );
  }

  if (filteredModels.length === 0) {
    return (
      <Box flexDirection="column" paddingX={1}>
        <Text color="yellow">No models match the filter.</Text>
        <Text dimColor>Press Esc to change filter.</Text>
      </Box>
    );
  }

  const effectiveIndex = Math.min(selectedIndex, Math.max(0, filteredModels.length - 1));

  // Calculate visible window (scroll with selection)
  const halfPage = Math.floor(PAGE_SIZE / 2);
  let startIdx = Math.max(0, effectiveIndex - halfPage);
  const endIdx = Math.min(filteredModels.length, startIdx + PAGE_SIZE);
  if (endIdx - startIdx < PAGE_SIZE && filteredModels.length >= PAGE_SIZE) {
    startIdx = Math.max(0, endIdx - PAGE_SIZE);
  }
  const visibleModels = filteredModels.slice(startIdx, endIdx);

  const filterLabel = isOpenRouter && openRouterFilter === 'free' ? ' (free only)' : isOpenRouter && openRouterFilter === 'all' ? ' (all)' : '';

  return (
    <Box flexDirection="column" paddingX={1}>
      <Text bold color="cyan">
        Select a model ({filteredModels.length} available){filterLabel}:
      </Text>
      {isOpenRouter && openRouterFilter !== null && (
        <Text dimColor>Esc back to filter</Text>
      )}
      <Box flexDirection="column" marginTop={1}>
        {visibleModels.map((m, i) => {
          const realIdx = startIdx + i;
          const isSelected = realIdx === effectiveIndex;
          const isCurrent = m.name === currentModel;
          const extra = m.size ? ` (${formatBytes(m.size)})` :
            m.displayName && m.displayName !== m.name ? ` - ${m.displayName}` : '';
          const freeBadge = m.free ? ' [free]' : '';
          const marker = isCurrent ? ' (active)' : '';

          return (
            <Text key={m.name}>
              <Text color={isSelected ? 'cyan' : undefined} bold={isSelected}>
                {isSelected ? '> ' : '  '}
                {m.name}
              </Text>
              <Text dimColor>{extra}{freeBadge}</Text>
              <Text color="green">{marker}</Text>
            </Text>
          );
        })}
      </Box>
      {filteredModels.length > PAGE_SIZE && (
        <Text dimColor>
          [{startIdx + 1}-{endIdx} of {filteredModels.length}]
        </Text>
      )}
      <Text dimColor>↑↓ navigate  Enter select  Esc {isOpenRouter && openRouterFilter !== null ? 'back' : 'cancel'}</Text>
    </Box>
  );
}
