import React, { useState, useEffect, useCallback, useRef } from 'react';
import { appendFileSync } from 'node:fs';
import { Box, Text, useInput } from 'ink';
import { getClipboardText } from '../utils/clipboard.js';

const DEBUG_KEYS = process.env.ORTHOS_DEBUG_KEYS === '1';

/** Strip bracketed-paste escape wrappers that terminals send around pasted text */
function stripBracketedPaste(s: string): string {
  return s.replace(/\x1b\[200~/g, '').replace(/\x1b\[201~/g, '');
}

/** Check if a string contains only printable characters (no control chars except newline/tab) */
function isPrintableText(s: string): boolean {
  return s.length > 0 && !/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/.test(s.replace(/\x1b\[\d*~?/g, ''));
}
function debugKey(label: string, input: string, key: Record<string, unknown>) {
  if (!DEBUG_KEYS) return;
  try {
    const line = `${label} input=${JSON.stringify(input)} (hex: ${[...input].map((c) => c.charCodeAt(0).toString(16)).join(' ')}) key.return=${key.return} key.shift=${key.shift} key.alt=${key.alt}\n`;
    appendFileSync('orthos-key-debug.log', line);
  } catch {
    // ignore
  }
}

interface PromptInputProps {
  onSubmit: (input: string) => void;
  isStreaming: boolean;
  onCancel: () => void;
  onSlashPress: () => void;
  onModelSwitch: () => void;
  inputKey: number;
  queueCount?: number;
}

export function PromptInput({
  onSubmit, isStreaming, onCancel, onSlashPress, onModelSwitch, inputKey, queueCount = 0,
}: PromptInputProps) {
  const [value, setValue] = useState('');
  const [cursorPos, setCursorPos] = useState(0);
  const valueRef = useRef(value);
  const cursorRef = useRef(cursorPos);
  valueRef.current = value;
  cursorRef.current = cursorPos;

  // Reset input when inputKey changes (after submit or external reset)
  useEffect(() => {
    setValue('');
    setCursorPos(0);
  }, [inputKey]);

  // Enable bracketed paste mode & listen for raw paste data on stdin
  useEffect(() => {
    const stdin = process.stdin;
    // Enable bracketed paste mode — tells the terminal to wrap pasted text in escape sequences
    process.stdout.write('\x1b[?2004h');

    let pasteBuffer = '';
    let isPasting = false;

    const onData = (data: Buffer) => {
      const str = data.toString('utf-8');

      // Detect bracketed paste start
      if (str.includes('\x1b[200~')) {
        isPasting = true;
        pasteBuffer = '';
        // Extract text after the start sequence
        const afterStart = str.split('\x1b[200~').slice(1).join('');
        // Check if end sequence is also in this chunk
        if (afterStart.includes('\x1b[201~')) {
          const pastedText = afterStart.split('\x1b[201~')[0];
          isPasting = false;
          if (pastedText) {
            const cleaned = pastedText.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
            setValue((v) => v.slice(0, cursorRef.current) + cleaned + v.slice(cursorRef.current));
            setCursorPos((p) => p + cleaned.length);
          }
        } else {
          pasteBuffer += afterStart;
        }
        return;
      }

      if (isPasting) {
        if (str.includes('\x1b[201~')) {
          // End of bracketed paste
          pasteBuffer += str.split('\x1b[201~')[0];
          isPasting = false;
          const cleaned = pasteBuffer.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
          if (cleaned) {
            setValue((v) => v.slice(0, cursorRef.current) + cleaned + v.slice(cursorRef.current));
            setCursorPos((p) => p + cleaned.length);
          }
          pasteBuffer = '';
        } else {
          pasteBuffer += str;
        }
      }
    };

    // Listen at a lower level than Ink — 'data' events on raw stdin
    if (stdin.readable) {
      stdin.on('data', onData);
    }

    return () => {
      // Disable bracketed paste mode on cleanup
      process.stdout.write('\x1b[?2004l');
      stdin.removeListener('data', onData);
    };
  }, []);

  useInput(useCallback((input: string, key) => {
    const keyAlt = (key as Record<string, boolean | undefined>).alt;
    if (DEBUG_KEYS && (key.return || key.shift || keyAlt || input === '\n' || input === '\r' || (typeof input === 'string' && input.startsWith('[')))) {
      debugKey('key', input, key as Record<string, unknown>);
    }

    // NEWLINE FIRST — before any other handler so it can't be skipped
    // Ctrl+J sends 0x0a (\n); Shift+Enter may send \n or \r\n or key.return+key.shift or CSI
    const isNewlineChar = input === '\n' || input === '\r\n' || (input.length === 1 && input.charCodeAt(0) === 10);
    const isShiftEnterEscape = typeof input === 'string' && /^\[(13|28);2[~R]$/.test(input);
    const isNewline =
      isNewlineChar ||
      (key.return && (key.shift || keyAlt)) ||
      (key.ctrl && (input === 'j' || input === 'J' || input.charCodeAt(0) === 10)) ||
      (key.shift && isShiftEnterEscape) ||
      (key.shift && input === '' && !key.tab && !key.escape && !key.backspace && !key.delete &&
       !key.upArrow && !key.downArrow && !key.leftArrow && !key.rightArrow &&
       !key.pageUp && !key.pageDown);
    if (isNewline) {
      setValue((v) => v.slice(0, cursorPos) + '\n' + v.slice(cursorPos));
      setCursorPos((p) => p + 1);
      return;
    }

    // Ctrl+C: cancel streaming or exit (handle both 'c' and raw \x03)
    const isCtrlC = (key.ctrl && (input === 'c' || input === 'C')) || input === '\x03';
    if (isCtrlC) {
      if (isStreaming) {
        onCancel();
      } else {
        process.exit(0);
      }
      return;
    }

    // Ctrl+V: paste from clipboard (handle both 'v' and raw Ctrl+V character 0x16)
    const isPaste = (key.ctrl && (input === 'v' || input === 'V')) || input === '\x16';
    if (isPaste) {
      getClipboardText().then((clipboardText) => {
        if (clipboardText) {
          setValue((v) => v.slice(0, cursorPos) + clipboardText + v.slice(cursorPos));
          setCursorPos((p) => p + clipboardText.length);
        }
      });
      return;
    }

    // Ctrl+L: open model picker (only when idle)
    if (key.ctrl && input === 'l') {
      if (!isStreaming) {
        onModelSwitch();
      }
      return;
    }

    // Submit: Enter (without shift/alt) — only \r / key.return
    if (key.return && !key.shift && !keyAlt) {
      const trimmed = value.trim();
      if (!trimmed) return;

      if (trimmed === '/') {
        onSlashPress();
        setValue('');
        setCursorPos(0);
        return;
      }

      onSubmit(trimmed);
      setValue('');
      setCursorPos(0);
      return;
    }

    // Backspace
    if (key.backspace || key.delete) {
      if (cursorPos > 0) {
        setValue((v) => v.slice(0, cursorPos - 1) + v.slice(cursorPos));
        setCursorPos((p) => p - 1);
      }
      return;
    }

    // Cursor movement
    if (key.leftArrow) {
      setCursorPos((p) => Math.max(0, p - 1));
      return;
    }
    if (key.rightArrow) {
      setCursorPos((p) => Math.min(value.length, p + 1));
      return;
    }

    // Home / End (Ctrl+A / Ctrl+E)
    if (key.ctrl && input === 'a') {
      setCursorPos(0);
      return;
    }
    if (key.ctrl && input === 'e') {
      setCursorPos(value.length);
      return;
    }

    // Escape: do nothing (handled by parent for menus)
    if (key.escape) return;

    // Tab: do nothing
    if (key.tab) return;

    // Regular character input — accept single chars AND multi-char paste bursts
    if (input && !key.ctrl && !key.meta) {
      // Strip any bracketed paste escape sequences that leaked through
      const cleaned = stripBracketedPaste(input);
      if (cleaned.length > 0 && isPrintableText(cleaned)) {
        setValue((v) => v.slice(0, cursorPos) + cleaned + v.slice(cursorPos));
        setCursorPos((p) => p + cleaned.length);
      }
    }
  }, [value, cursorPos, isStreaming, onCancel, onModelSwitch, onSubmit, onSlashPress]));

  // Render the input with cursor
  const placeholder = isStreaming ? 'Add to queue or /command...' : 'Ready for instructions';
  const showPlaceholder = value.length === 0;
  const promptColor = isStreaming ? 'yellow' : 'cyan';

  // Split value into lines for multiline rendering
  const lines = value.split('\n');

  // Build display with cursor
  const renderLines = () => {
    if (showPlaceholder) {
      return (
        <Box>
          <Text bold color={promptColor}>{'>'} </Text>
          <Text dimColor>{placeholder}</Text>
          {queueCount > 0 && <Text color="yellow"> ({queueCount} queued)</Text>}
        </Box>
      );
    }

    // Calculate cursor position within lines
    let charCount = 0;
    let cursorLine = 0;
    let cursorCol = 0;
    for (let i = 0; i < lines.length; i++) {
      if (cursorPos <= charCount + lines[i].length) {
        cursorLine = i;
        cursorCol = cursorPos - charCount;
        break;
      }
      charCount += lines[i].length + 1; // +1 for \n
    }

    return (
      <Box flexDirection="column">
        {lines.map((line, i) => (
          <Box key={i}>
            <Text bold color={promptColor}>{i === 0 ? '> ' : '  '}</Text>
            {i === cursorLine ? (
              <Text>
                {line.slice(0, cursorCol)}
                <Text inverse>{line[cursorCol] || ' '}</Text>
                {line.slice(cursorCol + 1)}
              </Text>
            ) : (
              <Text>{line}</Text>
            )}
            {i === 0 && queueCount > 0 && (
              <Text color="yellow"> ({queueCount} queued)</Text>
            )}
          </Box>
        ))}
      </Box>
    );
  };

  return (
    <Box flexDirection="column" paddingX={1} marginTop={0}>
      {renderLines()}
    </Box>
  );
}
