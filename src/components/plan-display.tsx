import React, { useCallback, useState, useEffect } from 'react';
import { Box, Text, useInput } from 'ink';
import type { Plan } from '../types/index.js';
import { planEvents } from '../core/planner.js';

interface PlanDisplayProps {
  plan: Plan;
  showApproval?: boolean;
  onApprove?: () => void;
  onReject?: () => void;
  onOther?: (specification: string) => void;
}

export function PlanDisplay({ plan, showApproval, onApprove, onReject, onOther }: PlanDisplayProps) {
  const [otherMode, setOtherMode] = useState(false);
  const [specLine, setSpecLine] = useState('');

  useInput(
    useCallback(
      (input: string, key) => {
        if (!showApproval) return;
        if (otherMode) {
          if (key.return) {
            onOther?.(specLine.trim());
            setOtherMode(false);
            setSpecLine('');
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
          onApprove?.();
        } else if (lower === 'n' || lower === 'q') {
          onReject?.();
        } else if (lower === 'o') {
          setOtherMode(true);
        }
      },
      [showApproval, onApprove, onReject, onOther, otherMode, specLine]
    )
  );

  // Force re-render when plan updates via Node.js EventEmitter
  const [, forceUpdate] = useState({});
  useEffect(() => {
    const handlePlanUpdate = () => {
      forceUpdate({});
    };

    planEvents.on('planStepUpdated', handlePlanUpdate);

    return () => {
      planEvents.off('planStepUpdated', handlePlanUpdate);
    };
  }, []);

  const width = Math.min(process.stdout.columns - 6 || 54, 60);

  return (
    <Box flexDirection="column" paddingX={2} marginY={0}>
      <Box borderStyle="round" borderColor="cyan" paddingX={2} paddingY={0} flexDirection="column">
        {/* Header */}
        <Text color="cyan" bold>{'📋'} Plan: {plan.title}</Text>
        <Text color="cyan" dimColor>{'─'.repeat(Math.min(width - 4, 50))}</Text>

        {/* Steps */}
        {plan.steps.map((step) => {
          const icon = getStepIcon(step.status);
          const color = getStepColor(step.status);
          const duration = step.duration ? ` (${formatDuration(step.duration)})` : '';

          return (
            <Box key={step.id}>
              <Text color={color} bold>{icon} </Text>
              <Text color={color} dimColor={step.status === 'pending'}>
                {step.id}. {step.title}
              </Text>
              {duration && <Text dimColor>{duration}</Text>}
            </Box>
          );
        })}

        {/* Approval prompt */}
        {showApproval && (
          <Box flexDirection="column" marginTop={0}>
            <Text color="cyan" dimColor>{'─'.repeat(Math.min(width - 4, 50))}</Text>
            {otherMode ? (
              <Box flexDirection="column">
                <Text dimColor>Enter specification (Enter to submit, Esc to cancel):</Text>
                <Box>
                  <Text color="cyan">{'>'} </Text>
                  <Text>{specLine || ' '}</Text>
                </Box>
              </Box>
            ) : (
              <Box>
                <Text>
                  <Text color="green" bold>[Y]</Text>
                  <Text dimColor>es, execute  </Text>
                  <Text color="red" bold>[N]</Text>
                  <Text dimColor>o, revise  </Text>
                  <Text color="cyan" bold>[O]</Text>
                  <Text dimColor>ther (add specification)</Text>
                </Text>
              </Box>
            )}
          </Box>
        )}
      </Box>
    </Box>
  );
}

function getStepIcon(status: string): string {
  switch (status) {
    case 'completed': return '✓';
    case 'in_progress': return '●';
    case 'failed': return '✗';
    default: return '○';
  }
}

function getStepColor(status: string): string {
  switch (status) {
    case 'completed': return 'green';
    case 'in_progress': return 'yellow';
    case 'failed': return 'red';
    default: return 'gray';
  }
}

function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}
