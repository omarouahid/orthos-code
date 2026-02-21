import React, { useCallback } from 'react';
import { Box, Text, useInput } from 'ink';
import { Select } from '@inkjs/ui';
import type { ModelInfo } from '../types/index.js';

interface ModelPickerProps {
  models: ModelInfo[];
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

export function ModelPicker({ models, onSelect, onCancel }: ModelPickerProps) {
  useInput(useCallback((_input: string, key) => {
    if (key.escape) {
      onCancel();
    }
  }, [onCancel]));

  const items = models.map((m) => {
    const extra = m.size ? ` (${formatBytes(m.size)})` :
      m.displayName && m.displayName !== m.name ? ` - ${m.displayName}` : '';
    return {
      label: `${m.name}${extra}`,
      value: m.name,
    };
  });

  return (
    <Box flexDirection="column" paddingX={1}>
      <Text bold color="cyan">Select a model:</Text>
      <Box marginTop={1}>
        <Select
          options={items}
          onChange={(val) => onSelect(val)}
        />
      </Box>
      <Text dimColor>↑↓ navigate  Enter select  Esc cancel</Text>
    </Box>
  );
}
