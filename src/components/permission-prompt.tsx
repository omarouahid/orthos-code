import React, { useCallback, useState } from 'react';
import { Box, Text, useInput } from 'ink';
import { formatToolCall } from '../core/tools/index.js';

interface PermissionPromptProps {
  toolName: string;
  toolArgs: Record<string, unknown>;
  onDecision: (approved: boolean, note?: string) => void;
}

export function PermissionPrompt({ toolName, toolArgs, onDecision }: PermissionPromptProps) {
  const [otherMode, setOtherMode] = useState(false);
  const [specLine, setSpecLine] = useState('');

  useInput(
    useCallback(
      (input: string, key) => {
        if (otherMode) {
          if (key.return) {
            onDecision(true, specLine.trim() || undefined);
            return;
          }
          if (key.backspace || key.delete) {
            setSpecLine((s) => s.slice(0, -1));
            return;
          }
          if (key.escape) {
            setOtherMode(false);
            setSpecLine('');
            return;
          }
          if (input && !key.ctrl && !key.meta && input.length === 1 && input >= ' ') {
            setSpecLine((s) => s + input);
          }
          return;
        }

        const lower = input.toLowerCase();
        if (lower === 'y' || lower === '\r') {
          onDecision(true);
        } else if (lower === 'n' || lower === 'q') {
          onDecision(false);
        } else if (lower === 'o') {
          setOtherMode(true);
        }
      },
      [onDecision, otherMode, specLine]
    )
  );

  const label = formatToolCall(toolName, toolArgs);
  const icon = getCategoryIcon(toolName);

  return (
    <Box flexDirection="column" paddingX={2} marginY={0}>
      <Box borderStyle="round" borderColor="yellow" paddingX={2} paddingY={0} flexDirection="column">
        <Text color="yellow" bold>{icon} Permission Required</Text>
        <Text> </Text>
        <Text>
          <Text dimColor>Tool: </Text>
          <Text bold>{toolName}</Text>
        </Text>
        <Text>
          <Text dimColor>Action: </Text>
          <Text>{label}</Text>
        </Text>
        <Text> </Text>
        {otherMode ? (
          <Box flexDirection="column">
            <Text dimColor>Enter your instructions (Enter to submit, Esc to cancel):</Text>
            <Box>
              <Text color="cyan">{'>'} </Text>
              <Text>{specLine || ' '}</Text>
            </Box>
          </Box>
        ) : (
          <Box>
            <Text>
              <Text color="green" bold>[Y]</Text>
              <Text dimColor>es  </Text>
              <Text color="red" bold>[N]</Text>
              <Text dimColor>o  </Text>
              <Text color="cyan" bold>[O]</Text>
              <Text dimColor>ther (add specification)  </Text>
              <Text dimColor>(</Text>
              <Text bold>--yolo</Text>
              <Text dimColor> / </Text>
              <Text bold>/yolo</Text>
              <Text dimColor> to auto-accept)</Text>
            </Text>
          </Box>
        )}
      </Box>
    </Box>
  );
}

function getCategoryIcon(toolName: string): string {
  if (toolName.startsWith('git_')) return '🔀';
  switch (toolName) {
    case 'write_file':
    case 'edit_file': return '✏️';
    case 'bash': return '💻';
    case 'read_file': return '📄';
    case 'grep':
    case 'glob': return '🔍';
    default: return '⚠️';
  }
}
