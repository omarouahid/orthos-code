import React, { useState, useCallback } from 'react';
import { Box, Text, useInput } from 'ink';

interface SessionItem {
  id: string;
  name: string;
  messageCount: number;
  date: string;
}

interface SessionPickerProps {
  sessions: SessionItem[];
  onSelect: (sessionId: string) => void;
  onCancel: () => void;
}

export function SessionPicker({ sessions, onSelect, onCancel }: SessionPickerProps) {
  const [selectedIndex, setSelectedIndex] = useState(0);

  useInput(useCallback((_input: string, key) => {
    if (key.escape) {
      onCancel();
      return;
    }

    if (key.return) {
      if (sessions.length > 0) {
        onSelect(sessions[selectedIndex].id);
      }
      return;
    }

    if (key.upArrow) {
      setSelectedIndex((i) => Math.max(0, i - 1));
      return;
    }

    if (key.downArrow) {
      setSelectedIndex((i) => Math.min(sessions.length - 1, i + 1));
    }
  }, [sessions, selectedIndex, onSelect, onCancel]));

  if (sessions.length === 0) {
    return (
      <Box flexDirection="column" paddingX={1}>
        <Text dimColor>No saved sessions.</Text>
        <Text dimColor>Press Esc to go back.</Text>
      </Box>
    );
  }

  return (
    <Box flexDirection="column" paddingX={1}>
      <Text bold color="cyan">Resume a session:</Text>
      <Box flexDirection="column" marginTop={0}>
        {sessions.map((s, i) => (
          <Box key={s.id}>
            <Text color={i === selectedIndex ? 'cyan' : undefined} bold={i === selectedIndex}>
              {i === selectedIndex ? '> ' : '  '}
            </Text>
            <Text color={i === selectedIndex ? 'cyan' : undefined} bold={i === selectedIndex}>
              {s.id}
            </Text>
            <Text color={i === selectedIndex ? 'white' : undefined} bold={i === selectedIndex}>
              {' '}{s.name}
            </Text>
            <Text dimColor> ({s.messageCount} msgs, {s.date})</Text>
          </Box>
        ))}
      </Box>
      <Text dimColor>↑↓ navigate  Enter resume  Esc cancel</Text>
    </Box>
  );
}
