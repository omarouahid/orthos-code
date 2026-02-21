import React from 'react';
import { Box, Text, useInput } from 'ink';
import type { Message } from '../types/index.js';

const MAX_DIFF_LINES = 200;

function formatDiffLine(line: string): { color?: string; text: string } {
  if (line.startsWith('+') && !line.startsWith('+++')) return { color: 'green', text: line };
  if (line.startsWith('-') && !line.startsWith('---')) return { color: 'red', text: line };
  if (line.startsWith('@@')) return { color: 'cyan', text: line };
  return { text: line };
}

function SingleDiff({ label, diff }: { label: string; diff: string }) {
  const lines = diff.split('\n').slice(0, MAX_DIFF_LINES);
  const truncated = diff.split('\n').length > MAX_DIFF_LINES;

  return (
    <Box flexDirection="column" marginBottom={1}>
      <Text bold color="cyan">
        {label}
      </Text>
      <Box flexDirection="column" paddingLeft={1}>
        {lines.map((line, i) => {
          const { color, text } = formatDiffLine(line);
          return (
            <Text key={i} color={color} dimColor={!color}>
              {text}
            </Text>
          );
        })}
        {truncated && (
          <Text dimColor>... ({diff.split('\n').length - MAX_DIFF_LINES} more lines)</Text>
        )}
      </Box>
    </Box>
  );
}

export interface DiffViewerProps {
  message: Message | null;
  onClose: () => void;
}

export function DiffViewer({ message, onClose }: DiffViewerProps) {
  useInput((_input, key) => {
    if (key.escape) onClose();
  });

  if (!message || message.role !== 'assistant' || !message.toolCalls?.length || !message.toolResults?.length) {
    return (
      <Box paddingX={2}>
        <Text dimColor>No file changes in this message.</Text>
      </Box>
    );
  }

  const toolCalls = message.toolCalls;
  const results = message.toolResults;
  const diffs: { label: string; diff: string }[] = [];

  for (let i = 0; i < toolCalls.length; i++) {
    const tc = toolCalls[i];
    const res = results[i];
    if (!res?.diff) continue;
    const path = (tc.arguments?.path as string) || (tc.arguments?.path_relative as string) || `edit ${i + 1}`;
    diffs.push({ label: path, diff: res.diff });
  }

  if (diffs.length === 0) {
    return (
      <Box paddingX={2}>
        <Text dimColor>No file changes in this message.</Text>
      </Box>
    );
  }

  return (
    <Box flexDirection="column" paddingX={2} marginY={1}>
      <Box borderStyle="round" borderColor="cyan" paddingX={1} flexDirection="column">
        <Box marginBottom={0}>
          <Text bold color="cyan">
            📄 File changes
          </Text>
          <Text dimColor> — Esc to close</Text>
        </Box>
        {diffs.map((d, i) => (
          <SingleDiff key={i} label={d.label} diff={d.diff} />
        ))}
      </Box>
    </Box>
  );
}
