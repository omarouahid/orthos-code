import React from 'react';
import { Box, Text } from 'ink';
import type { Plan } from '../types/index.js';

interface TaskTrackerProps {
  plan: Plan;
}

export function TaskTracker({ plan }: TaskTrackerProps) {
  const completed = plan.steps.filter((s) => s.status === 'completed').length;
  const total = plan.steps.length;

  return (
    <Box flexDirection="column" paddingX={2} marginY={0}>
      <Box marginBottom={0}>
        <Text dimColor bold>{'📋'} </Text>
        <Text dimColor>{plan.title}</Text>
        <Text dimColor> — </Text>
        <Text color={completed === total ? 'green' : 'yellow'} bold>
          {completed}/{total}
        </Text>
      </Box>
      {plan.steps.map((step) => {
        const icon = getIcon(step.status);
        const color = getColor(step.status);
        const duration = step.duration ? formatDuration(step.duration) : step.status === 'in_progress' ? '...' : '';
        const roleBadge = step.agentRole;

        return (
          <Box key={step.id} paddingLeft={2}>
            {roleBadge && (
              <Box width={12}>
                <Text color="cyan" bold>[{roleBadge.toUpperCase()}]</Text>
              </Box>
            )}
            <Text color={color} bold>{icon} </Text>
            <Text color={color} dimColor={step.status === 'pending'} bold={step.status === 'in_progress'}>
              {step.title}
            </Text>
            {duration && (
              <Box marginLeft={1}>
                <Text dimColor>{duration}</Text>
              </Box>
            )}
          </Box>
        );
      })}
    </Box>
  );
}

function getIcon(status: string): string {
  switch (status) {
    case 'completed': return '✓';
    case 'in_progress': return '●';
    case 'failed': return '✗';
    default: return '○';
  }
}

function getColor(status: string): string {
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
