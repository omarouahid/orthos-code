import React, { useCallback, useState } from 'react';
import { Box, Text, useInput } from 'ink';
import type { ModelInfo } from '../types/index.js';
import type { ExecutionMode } from '../core/orchestrator/types.js';

type Stage = 'confirm' | 'execution-mode' | 'coder-model';

interface AgentModePromptProps {
  reason: string;
  models: ModelInfo[];
  currentModel: string;
  onConfirm: (config: { executionMode: ExecutionMode; coderModel: string }) => void;
  onCancel: () => void;
}

export function AgentModePrompt({ reason, models, currentModel, onConfirm, onCancel }: AgentModePromptProps) {
  const [stage, setStage] = useState<Stage>('confirm');
  const [executionMode, setExecutionMode] = useState<ExecutionMode>('sequential');
  const [modelIndex, setModelIndex] = useState(0);
  const [showModelList, setShowModelList] = useState(false);

  useInput(useCallback((input: string, key) => {
    const lower = input.toLowerCase();

    if (stage === 'confirm') {
      if (lower === 'y' || key.return) {
        setStage('execution-mode');
      } else if (lower === 'n' || key.escape) {
        onCancel();
      }
      return;
    }

    if (stage === 'execution-mode') {
      if (lower === 's') {
        setExecutionMode('sequential');
        setStage('coder-model');
      } else if (lower === 'p') {
        setExecutionMode('parallel');
        setStage('coder-model');
      } else if (key.escape) {
        setStage('confirm');
      }
      return;
    }

    if (stage === 'coder-model') {
      if (showModelList) {
        if (key.upArrow) {
          setModelIndex((i) => Math.max(0, i - 1));
        } else if (key.downArrow) {
          setModelIndex((i) => Math.min(models.length - 1, i + 1));
        } else if (key.return) {
          const selected = models[modelIndex];
          if (selected) {
            onConfirm({ executionMode, coderModel: selected.name });
          }
        } else if (key.escape) {
          setShowModelList(false);
        }
      } else {
        if (lower === 'a' || key.return) {
          onConfirm({ executionMode, coderModel: currentModel });
        } else if (lower === 'c') {
          setShowModelList(true);
          setModelIndex(0);
        } else if (key.escape) {
          setStage('execution-mode');
        }
      }
    }
  }, [stage, executionMode, models, modelIndex, currentModel, showModelList, onConfirm, onCancel]));

  const width = Math.min(process.stdout.columns - 6 || 54, 60);

  return (
    <Box flexDirection="column" paddingX={2} marginY={0}>
      <Box borderStyle="round" borderColor="magenta" paddingX={2} paddingY={0} flexDirection="column">
        <Text color="magenta" bold>{'🤖'} Agent Mode</Text>
        <Text color="magenta" dimColor>{'─'.repeat(Math.min(width - 4, 50))}</Text>

        {stage === 'confirm' && (
          <Box flexDirection="column">
            <Text>This task looks complex: <Text color="yellow">{reason}</Text></Text>
            <Text dimColor>Use specialized agents (Coder, Researcher, Reviewer)?</Text>
            <Box marginTop={0}>
              <Text color="green" bold>[Y]</Text>
              <Text dimColor>es, use agents  </Text>
              <Text color="red" bold>[N]</Text>
              <Text dimColor>o, handle normally</Text>
            </Box>
          </Box>
        )}

        {stage === 'execution-mode' && (
          <Box flexDirection="column">
            <Text>How should agents run?</Text>
            <Box marginTop={0}>
              <Text color="cyan" bold>[S]</Text>
              <Text dimColor>equential — one at a time, safer  </Text>
            </Box>
            <Box>
              <Text color="cyan" bold>[P]</Text>
              <Text dimColor>arallel — concurrent, faster</Text>
            </Box>
          </Box>
        )}

        {stage === 'coder-model' && !showModelList && (
          <Box flexDirection="column">
            <Text>Model for coder agents?</Text>
            <Box marginTop={0}>
              <Text color="cyan" bold>[A]</Text>
              <Text dimColor>uto — use current ({currentModel})  </Text>
            </Box>
            <Box>
              <Text color="cyan" bold>[C]</Text>
              <Text dimColor>hoose — pick a specific model</Text>
            </Box>
          </Box>
        )}

        {stage === 'coder-model' && showModelList && (
          <Box flexDirection="column">
            <Text dimColor>Pick coder model (↑↓ + Enter):</Text>
            {models.slice(0, 10).map((m, i) => (
              <Box key={m.name}>
                <Text color={i === modelIndex ? 'cyan' : undefined} bold={i === modelIndex}>
                  {i === modelIndex ? '❯ ' : '  '}{m.displayName || m.name}
                </Text>
              </Box>
            ))}
            {models.length > 10 && (
              <Text dimColor>  ...and {models.length - 10} more</Text>
            )}
          </Box>
        )}

        <Text dimColor>Esc to go back</Text>
      </Box>
    </Box>
  );
}
