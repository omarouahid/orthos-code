import { appendFileSync, mkdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

const LOG_DIR = join(homedir(), '.orthos-code', 'logs');
const LOG_FILE = 'orthos.log';
const MAX_STRINGIFY_LENGTH = 2000;

let logPath: string | null = null;
let enabled: boolean | null = null;

function getLogPath(): string {
  if (logPath) return logPath;
  try {
    mkdirSync(LOG_DIR, { recursive: true });
  } catch {
    // ignore
  }
  logPath = join(LOG_DIR, LOG_FILE);
  return logPath;
}

function isEnabled(): boolean {
  if (enabled !== null) return enabled;
  const v = process.env.ORTHOS_DEBUG ?? process.env.ORTHOS_LOG ?? '';
  // On by default; set ORTHOS_DEBUG=0 or ORTHOS_LOG=0 to turn off
  enabled = v !== '0' && v !== 'false' && v !== 'no';
  return enabled;
}

function safeStringify(obj: unknown): string {
  try {
    const s = typeof obj === 'string' ? obj : JSON.stringify(obj);
    if (s.length <= MAX_STRINGIFY_LENGTH) return s;
    return s.slice(0, MAX_STRINGIFY_LENGTH) + '...[truncated]';
  } catch {
    return String(obj).slice(0, MAX_STRINGIFY_LENGTH);
  }
}

export type StepCategory =
  | 'user_input'
  | 'tool_loop'
  | 'llm_request'
  | 'llm_response'
  | 'tool_call'
  | 'tool_result'
  | 'tool_retry'
  | 'compact'
  | 'plan'
  | 'error'
  | 'telegram'
  | 'voice'
  | 'session';

let currentRunId: string | null = null;

/** Set the current run/session id for step logs (e.g. at start of handleUserInput). */
export function setStepLogRunId(id: string | null): void {
  currentRunId = id;
}

/** Current run id (for step log lines). */
export function getStepLogRunId(): string | null {
  return currentRunId;
}

/**
 * Write a single step line to the debug log.
 * Logs are stored in ~/.orthos-code/logs/orthos.log (on by default; set ORTHOS_DEBUG=0 to turn off).
 * Each line is: ISO timestamp \t runId \t category \t message \t [optional JSON]
 */
export function stepLog(step: StepCategory, message: string, data?: Record<string, unknown>): void {
  if (!isEnabled()) return;
  try {
    const ts = new Date().toISOString();
    const runId = currentRunId ?? '-';
    const dataStr = data ? '\t' + safeStringify(data) : '';
    const line = `${ts}\t${runId}\t${step}\t${message}${dataStr}\n`;
    appendFileSync(getLogPath(), line, 'utf8');
  } catch {
    // avoid breaking app if log write fails
  }
}

/** Enable or disable step logging programmatically (e.g. from config). */
export function setStepLogEnabled(value: boolean): void {
  enabled = value;
}

/** Return the current log file path (for /config or docs). */
export function getStepLogFilePath(): string {
  return getLogPath();
}
