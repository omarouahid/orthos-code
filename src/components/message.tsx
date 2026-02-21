import React, { useState } from 'react';
import { Box, Text } from 'ink';
import { renderMarkdown } from './markdown-renderer.js';
import type { ToolResult } from '../core/tools/types.js';
import type { Plan } from '../types/index.js';
import { copyToClipboard } from '../utils/clipboard.js';

interface MessageProps {
  role: 'user' | 'assistant' | 'system' | 'tool';
  content: string;
  isStreaming?: boolean;
  attachments?: Array<{ path: string; size: number }>;
  isCompactSummary?: boolean;
  toolCalls?: Array<{ name: string; arguments: Record<string, unknown> }>;
  toolResults?: ToolResult[];
  thinking?: string;
  plan?: Plan;
  setSelectedMessageId?: (id: string | null) => void;
  onViewDiff?: (messageId: string) => void;
  messageId?: string;
}

export function Message({
  role, content, isStreaming, attachments,
  isCompactSummary, toolCalls, toolResults, thinking, plan,
  setSelectedMessageId, onViewDiff, messageId,
}: MessageProps) {
  if (role === 'user') {
    return (
      <Box flexDirection="column" paddingX={2} marginY={0}>
        <Box>
          <Text bold color="green">{'❯'} </Text>
          <Text>{content}</Text>
        </Box>
        {attachments && attachments.length > 0 && (
          <Box paddingLeft={2}>
            {attachments.map((a, i) => (
              <Text key={i} dimColor>
                {'📎'} {a.path} ({formatBytes(a.size)}){'  '}
              </Text>
            ))}
          </Box>
        )}
      </Box>
    );
  }

  // Tool messages (result display)
  if (role === 'tool') {
    return null; // Tool results are displayed inline with the assistant message
  }

  // Assistant message
  const rendered = content ? renderMarkdown(content) : '';
  const [copied, setCopied] = useState(false);

  const handleCopy = async () => {
    if (content) {
      const success = await copyToClipboard(content);
      if (success) {
        setCopied(true);
        setTimeout(() => setCopied(false), 2000); // Reset after 2 seconds
      }
    }
  };

  const handleMessageClick = () => {
    // Only set selection for assistant messages that have content
    if (role === 'assistant' && content && setSelectedMessageId && messageId) {
      setSelectedMessageId(messageId);
    }
  };

  return (
    <Box flexDirection="column" paddingX={2} marginY={0} onClick={handleMessageClick}>
      {/* Header */}
      <Box marginBottom={0}>
        {isCompactSummary ? (
          <Text dimColor bold>{'📋'} </Text>
        ) : (
          <Text bold color="cyan">{'⚡'} </Text>
        )}
        <Text dimColor>{isCompactSummary ? 'Summary' : 'Orthos'}</Text>
        {isStreaming && <Text color="yellow"> {'●'}</Text>}
        {!isStreaming && content && (
          <Box marginLeft={1}>
            <Text dimColor>
              [{copied ? '✓ Copied!' : <Text onPress={handleCopy} clickable>Copy</Text>}]
              {toolResults?.some((r) => r.diff) && onViewDiff && messageId && (
                <>
                  <Text dimColor> </Text>
                  <Text onPress={() => onViewDiff(messageId)} clickable dimColor>
                    View diff
                  </Text>
                </>
              )}
            </Text>
          </Box>
        )}
      </Box>

      {/* Thinking / reasoning */}
      {thinking && (
        <Box paddingLeft={2} marginBottom={0}>
          <Box borderStyle="round" borderColor="gray" paddingX={1}>
            <Box flexDirection="column">
              <Text dimColor bold>{'💭'} Thinking</Text>
              <Text dimColor>{thinking}</Text>
            </Box>
          </Box>
        </Box>
      )}

      {/* Inline plan display (completed) */}
      {plan && (
        <Box flexDirection="column" paddingLeft={2} marginBottom={0}>
          <Box borderStyle="round" borderColor="cyan" paddingX={1} flexDirection="column">
            <Text color="cyan" bold>{'📋'} {plan.title}</Text>
            {plan.steps.map((step) => {
              const icon = step.status === 'completed' ? '✓' : step.status === 'failed' ? '✗' : step.status === 'in_progress' ? '●' : '○';
              const color = step.status === 'completed' ? 'green' : step.status === 'failed' ? 'red' : step.status === 'in_progress' ? 'yellow' : 'gray';
              return (
                <Text key={step.id} color={color}>
                  {icon} {step.id}. {step.title}
                </Text>
              );
            })}
          </Box>
        </Box>
      )}

      {/* Tool calls + results */}
      {toolCalls && toolCalls.length > 0 && (
        <Box flexDirection="column" paddingLeft={2} marginBottom={0}>
          {toolCalls.map((tc, i) => (
            <ToolCallDisplay
              key={i}
              name={tc.name}
              args={tc.arguments}
              result={toolResults?.[i]}
            />
          ))}
        </Box>
      )}

      {/* Main content */}
      {rendered && (
        <Box paddingLeft={2}>
          <Text>{rendered}</Text>
        </Box>
      )}
    </Box>
  );
}

function ToolCallDisplay({
  name, args, result,
}: {
  name: string;
  args: Record<string, unknown>;
  result?: ToolResult;
}) {
  const icon = getToolIcon(name);
  const label = formatToolLabel(name, args);
  const statusColor = result
    ? (result.success ? 'green' : 'red')
    : 'yellow';
  const statusIcon = result
    ? (result.success ? '✓' : '✗')
    : '…';

  return (
    <Box flexDirection="column" marginBottom={0}>
      {/* Tool call header */}
      <Box>
        <Text color={statusColor} bold>{statusIcon} </Text>
        <Text dimColor>{icon} </Text>
        <Text bold>{label}</Text>
        {result && (
          <Text dimColor> ({result.duration}ms)</Text>
        )}
      </Box>

      {/* Diff output for write/edit — compact to avoid scroll jump */}
      {result?.diff && (
        <Box flexDirection="column" paddingLeft={4}>
          <DiffDisplay diff={result.diff} maxLines={8} />
        </Box>
      )}

      {/* Tool output (truncated to keep view stable) */}
      {result && result.output && !result.diff && (
        <Box paddingLeft={4}>
          <Text dimColor>{truncateOutput(result.output, 8)}</Text>
        </Box>
      )}

      {/* Error output */}
      {result && !result.success && (
        <Box paddingLeft={4}>
          <Text color="red">{truncateOutput(result.output, 5)}</Text>
        </Box>
      )}
    </Box>
  );
}

const DIFF_PREVIEW_LINES = 8;

function diffSummary(diff: string): string {
  const lines = diff.split('\n');
  let add = 0;
  let del = 0;
  for (const line of lines) {
    if (line.startsWith('+') && !line.startsWith('+++')) add++;
    else if (line.startsWith('-') && !line.startsWith('---')) del++;
  }
  if (add && del) return `${add} added, ${del} removed`;
  if (add) return `${add} lines added`;
  if (del) return `${del} lines removed`;
  return 'updated';
}

function DiffDisplay({ diff, maxLines = DIFF_PREVIEW_LINES }: { diff: string; maxLines?: number }) {
  const allLines = diff.split('\n');
  const lines = allLines.slice(0, maxLines);
  const total = allLines.length;
  const hasMore = total > maxLines;

  return (
    <Box flexDirection="column">
      <Text dimColor>  {diffSummary(diff)}</Text>
      {lines.map((line, i) => {
        let color: string | undefined;
        if (line.startsWith('+')) color = 'green';
        else if (line.startsWith('-')) color = 'red';
        else if (line.startsWith('@@')) color = 'cyan';

        return (
          <Text key={i} color={color} dimColor={!color}>
            {line}
          </Text>
        );
      })}
      {hasMore && (
        <Text dimColor>  ... {total - maxLines} more lines</Text>
      )}
    </Box>
  );
}

function getToolIcon(name: string): string {
  const icons: Record<string, string> = {
    read_file: '📄',
    write_file: '✏️',
    edit_file: '🔧',
    bash: '💻',
    grep: '🔍',
    glob: '📂',
    git_status: '📊',
    git_diff: '📋',
    git_commit: '📝',
    git_log: '📜',
  };
  return icons[name] || '🔧';
}

function formatToolLabel(name: string, args: Record<string, unknown>): string {
  switch (name) {
    case 'read_file': return `Read ${args.path}`;
    case 'write_file': return `Write ${args.path}`;
    case 'edit_file': return `Edit ${args.path}`;
    case 'bash': return `$ ${args.command}`;
    case 'grep': return `grep "${args.pattern}" ${args.path || '.'}`;
    case 'glob': return `glob ${args.pattern}`;
    case 'git_status': return 'git status';
    case 'git_diff': return `git diff${args.path ? ` ${args.path}` : ''}`;
    case 'git_commit': return `git commit -m "${args.message}"`;
    case 'git_log': return 'git log';
    default: return `${name}(${JSON.stringify(args)})`;
  }
}

function truncateOutput(output: string, maxLines: number): string {
  const lines = output.split('\n');
  if (lines.length <= maxLines) return output;
  return lines.slice(0, maxLines).join('\n') + `\n... (${lines.length - maxLines} more lines)`;
}

function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return Math.round((bytes / Math.pow(k, i)) * 100) / 100 + ' ' + sizes[i];
}
