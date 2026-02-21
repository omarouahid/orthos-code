import React from 'react';
import { Box, Text } from 'ink';

interface BottomBarProps {
  isStreaming?: boolean;
  yolo?: boolean;
}

export function BottomBar({ isStreaming, yolo }: BottomBarProps) {
  const width = process.stdout.columns || 80;
  const dot = '\u2022';

  return (
    <Box paddingX={1} marginTop={0} width={Math.min(width, 120)}>
      <Box gap={0}>
        {yolo && (
          <>
            <Text color="yellow" bold>YOLO</Text>
            <Text dimColor> {dot} </Text>
          </>
        )}
        {isStreaming ? (
          <Text dimColor>
            <Text bold color="yellow">ctrl+c</Text> stop
            <Text dimColor> {dot} </Text>
            <Text bold color="yellow">enter</Text> queue msg
            <Text dimColor> {dot} </Text>
            <Text bold color="yellow">/</Text> commands
          </Text>
        ) : (
          <Text dimColor>
            <Text bold color="cyan">/</Text> commands
            <Text dimColor> {dot} </Text>
            <Text bold color="cyan">shift+enter</Text> / <Text bold color="cyan">ctrl+j</Text> / <Text bold color="cyan">alt+enter</Text> newline
            <Text dimColor> {dot} </Text>
            <Text bold color="cyan">ctrl+l</Text> models
            <Text dimColor> {dot} </Text>
            <Text bold color="cyan">ctrl+v</Text> paste
            <Text dimColor> {dot} </Text>
            <Text bold color="cyan">ctrl+shift+c</Text> copy msg
            <Text dimColor> {dot} </Text>
            <Text bold color="cyan">ctrl+c</Text> quit
          </Text>
        )}
      </Box>
    </Box>
  );
}
