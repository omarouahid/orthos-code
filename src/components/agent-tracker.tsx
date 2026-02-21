import React, { useState, useEffect } from 'react';
import { Box, Text } from 'ink';
import type { Plan } from '../types/index.js';
import type { OrchestrationSession, AgentProgressEvent } from '../core/orchestrator/types.js';
import { agentEvents, orchestratorEvents } from '../core/orchestrator/index.js';

interface AgentTrackerProps {
  plan: Plan;
  session: OrchestrationSession;
}

export function AgentTracker({ plan, session }: AgentTrackerProps) {
  const [agentActivity, setAgentActivity] = useState<Map<number, string>>(new Map());
  const [, forceUpdate] = useState({});

  useEffect(() => {
    const onProgress = (event: AgentProgressEvent) => {
      if (event.detail) {
        setAgentActivity((prev) => {
          const next = new Map(prev);
          next.set(event.stepId, event.detail || '');
          return next;
        });
      }
      forceUpdate({});
    };

    const onAgentDone = () => { forceUpdate({}); };

    agentEvents.on('agentProgress', onProgress);
    orchestratorEvents.on('agentStarted', onAgentDone);
    orchestratorEvents.on('agentCompleted', onAgentDone);
    orchestratorEvents.on('agentFailed', onAgentDone);

    return () => {
      agentEvents.off('agentProgress', onProgress);
      orchestratorEvents.off('agentStarted', onAgentDone);
      orchestratorEvents.off('agentCompleted', onAgentDone);
      orchestratorEvents.off('agentFailed', onAgentDone);
    };
  }, []);

  const completed = plan.steps.filter((s) => s.status === 'completed').length;
  const total = plan.steps.length;

  return (
    <Box flexDirection="column" paddingX={2} marginY={0}>
      <Box marginBottom={0}>
        <Text dimColor bold>{'🤖'} </Text>
        <Text dimColor>{plan.title}</Text>
        <Text dimColor> — </Text>
        <Text color={completed === total ? 'green' : 'yellow'} bold>
          {completed}/{total}
        </Text>
        <Text dimColor> ({session.executionMode})</Text>
      </Box>
      {plan.steps.map((step) => {
        const icon = getIcon(step.status);
        const color = getColor(step.status);
        const duration = step.duration ? formatDuration(step.duration) : '';

        // Find agent task for this step
        const agentTask = session.tasks.find((t) => t.stepId === step.id);
        const roleBadge = step.agentRole || agentTask?.role;
        const activity = agentActivity.get(step.id);

        return (
          <Box key={step.id} paddingLeft={2}>
            {roleBadge && (
              <Box width={12}>
                <Text color={getRoleColor(roleBadge)} bold>[{roleBadge.toUpperCase()}]</Text>
              </Box>
            )}
            <Text color={color} bold>{icon} </Text>
            <Text color={color} dimColor={step.status === 'pending'} bold={step.status === 'in_progress'}>
              {step.title}
            </Text>
            {duration && (
              <Box marginLeft={1}>
                <Text dimColor>({duration})</Text>
              </Box>
            )}
            {step.status === 'in_progress' && activity && (
              <Box marginLeft={1}>
                <Text dimColor italic>{activity}</Text>
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

function getRoleColor(role: string): string {
  switch (role) {
    case 'coder': return 'cyan';
    case 'researcher': return 'blue';
    case 'reviewer': return 'magenta';
    default: return 'gray';
  }
}

function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}
