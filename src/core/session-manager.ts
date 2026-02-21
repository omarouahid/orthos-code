import Conf from 'conf';
import type { Message } from '../types/index.js';

interface Session {
  id: string;
  name: string;
  messages: Message[];
  model: string;
  cwd: string;
  createdAt: number;
  updatedAt: number;
}

interface SessionStore {
  sessions: Record<string, Session>;
  currentSessionId: string;
  sessionCounter: number;
}

const store = new Conf<SessionStore>({
  projectName: 'orthos-code-sessions',
  defaults: {
    sessions: {},
    currentSessionId: '',
    sessionCounter: 0,
  },
});

/**
 * Generate a short readable ID like "s1", "s2", etc.
 */
function nextSessionId(): string {
  const counter = store.get('sessionCounter') + 1;
  store.set('sessionCounter', counter);
  return `s${counter}`;
}

/**
 * Generate a meaningful title from the first user message.
 * Extracts the key intent in ~40 chars.
 */
function generateTitle(messages: Message[]): string {
  const firstUserMsg = messages.find((m) => m.role === 'user');
  if (!firstUserMsg) return 'New conversation';

  let text = firstUserMsg.content.trim();

  // Remove file references like @src/app.tsx
  text = text.replace(/@\S+/g, '').trim();

  // Remove slash commands
  if (text.startsWith('/')) return 'New conversation';

  // Clean up whitespace
  text = text.replace(/\s+/g, ' ');

  // Truncate to a reasonable title length
  if (text.length <= 50) return text;

  // Cut at word boundary
  const truncated = text.slice(0, 50);
  const lastSpace = truncated.lastIndexOf(' ');
  return (lastSpace > 20 ? truncated.slice(0, lastSpace) : truncated) + '...';
}

export function createSession(model: string, cwd: string): string {
  const id = nextSessionId();
  const session: Session = {
    id,
    name: 'New conversation',
    messages: [],
    model,
    cwd,
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };

  const sessions = store.get('sessions');
  sessions[id] = session;
  store.set('sessions', sessions);
  store.set('currentSessionId', id);
  return id;
}

export function getCurrentSession(): Session | null {
  const id = store.get('currentSessionId');
  if (!id) return null;
  const sessions = store.get('sessions');
  return sessions[id] || null;
}

export function saveSession(messages: Message[], model: string): void {
  let id = store.get('currentSessionId');
  const sessions = store.get('sessions');

  if (!id || !sessions[id]) {
    id = createSession(model, process.cwd());
  }

  // Auto-generate title from first user message if still default
  const currentName = sessions[id]?.name;
  const name = (!currentName || currentName === 'New conversation')
    ? generateTitle(messages)
    : currentName;

  sessions[id] = {
    ...sessions[id],
    messages,
    model,
    name,
    updatedAt: Date.now(),
  };
  store.set('sessions', sessions);
}

export function listSessions(): Session[] {
  const sessions = store.get('sessions');
  return Object.values(sessions)
    .sort((a, b) => b.updatedAt - a.updatedAt)
    .slice(0, 20);
}

export function resumeSession(id: string): Session | null {
  const sessions = store.get('sessions');
  const session = sessions[id];
  if (session) {
    store.set('currentSessionId', id);
    return session;
  }
  return null;
}

export function deleteSession(id: string): boolean {
  const sessions = store.get('sessions');
  if (sessions[id]) {
    delete sessions[id];
    store.set('sessions', sessions);
    if (store.get('currentSessionId') === id) {
      store.set('currentSessionId', '');
    }
    return true;
  }
  return false;
}

export function clearAllSessions(): void {
  store.set('sessions', {});
  store.set('currentSessionId', '');
}

export function getCurrentSessionId(): string {
  return store.get('currentSessionId');
}
