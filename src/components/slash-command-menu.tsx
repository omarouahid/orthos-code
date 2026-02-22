import React, { useState, useCallback } from 'react';
import { Box, Text, useInput } from 'ink';

interface CommandItem {
  name: string;
  description: string;
  aliases: string[];
}

const COMMANDS: CommandItem[] = [
  { name: 'help', description: 'Show available commands', aliases: ['h', '?'] },
  { name: 'model', description: 'Switch model', aliases: ['m'] },
  { name: 'models', description: 'Open model picker', aliases: [] },
  { name: 'clear', description: 'Clear conversation', aliases: ['c'] },
  { name: 'compact', description: 'Compact messages', aliases: [] },
  { name: 'tokens', description: 'Show token usage', aliases: ['t'] },
  { name: 'yolo', description: 'Toggle YOLO mode', aliases: [] },
  { name: 'permissions', description: 'Show permissions', aliases: ['perms'] },
  { name: 'sessions', description: 'List sessions', aliases: [] },
  { name: 'resume', description: 'Resume session', aliases: [] },
  { name: 'plan', description: 'Show plan status', aliases: [] },
  { name: 'diff', description: 'Inspect file changes', aliases: ['inspect', 'd'] },
  { name: 'admin', description: 'Toggle Admin mode', aliases: [] },
  { name: 'agent', description: 'Toggle Agent mode', aliases: ['agents'] },
  { name: 'provider', description: 'Switch LLM provider', aliases: ['p'] },
  { name: 'setup', description: 'Setup API keys', aliases: [] },
  { name: 'telegram', description: 'Control Telegram bot', aliases: ['tg'] },
  { name: 'browser', description: 'Control browser extension', aliases: [] },
  { name: 'skill', description: 'Manage skills (workflows)', aliases: [] },
  { name: 'exit', description: 'Exit Orthos Code', aliases: ['quit', 'q'] },
];

interface SlashCommandMenuProps {
  onSelect: (command: string) => void;
  onClose: () => void;
}

export function SlashCommandMenu({ onSelect, onClose }: SlashCommandMenuProps) {
  const [filter, setFilter] = useState('');
  const [selectedIndex, setSelectedIndex] = useState(0);

  const filtered = COMMANDS.filter((cmd) => {
    if (!filter) return true;
    const lower = filter.toLowerCase();
    return cmd.name.includes(lower) ||
           cmd.description.toLowerCase().includes(lower) ||
           cmd.aliases.some((a) => a.includes(lower));
  });

  useInput(useCallback((input: string, key) => {
    if (key.escape) {
      onClose();
      return;
    }

    if (key.return) {
      if (filtered.length > 0) {
        onSelect(`/${filtered[selectedIndex].name}`);
      }
      return;
    }

    if (key.upArrow) {
      setSelectedIndex((i) => Math.max(0, i - 1));
      return;
    }

    if (key.downArrow) {
      setSelectedIndex((i) => Math.min(filtered.length - 1, i + 1));
      return;
    }

    if (key.backspace || key.delete) {
      setFilter((f) => f.slice(0, -1));
      setSelectedIndex(0);
      return;
    }

    // Regular character input for filtering
    if (input && !key.ctrl && !key.meta && input.length === 1 && input >= ' ') {
      setFilter((f) => f + input);
      setSelectedIndex(0);
    }
  }, [filtered, selectedIndex, onSelect, onClose]));

  return (
    <Box flexDirection="column" paddingX={1} marginY={0}>
      <Box borderStyle="round" borderColor="cyan" flexDirection="column" paddingX={1}>
        {/* Header */}
        <Box>
          <Text color="cyan" bold>Commands</Text>
          {filter && (
            <Text dimColor> — filter: <Text color="cyan">{filter}</Text></Text>
          )}
        </Box>

        {/* Command list */}
        {filtered.length > 0 ? (
          filtered.map((cmd, i) => (
            <Box key={cmd.name}>
              <Text color={i === selectedIndex ? 'cyan' : undefined} bold={i === selectedIndex}>
                {i === selectedIndex ? '> ' : '  '}
              </Text>
              <Text color={i === selectedIndex ? 'cyan' : 'white'} bold={i === selectedIndex}>
                /{cmd.name}
              </Text>
              <Text dimColor>  {cmd.description}</Text>
              {cmd.aliases.length > 0 && (
                <Text dimColor> ({cmd.aliases.map((a) => `/${a}`).join(', ')})</Text>
              )}
            </Box>
          ))
        ) : (
          <Text dimColor>  No matching commands</Text>
        )}

        {/* Footer */}
        <Box marginTop={0}>
          <Text dimColor>
            <Text bold>↑↓</Text> select  <Text bold>Enter</Text> run  <Text bold>Esc</Text> close
          </Text>
        </Box>
      </Box>
    </Box>
  );
}
