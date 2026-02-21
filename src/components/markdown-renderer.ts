import { marked } from 'marked';
import { markedTerminal } from 'marked-terminal';

const MAX_CACHE_SIZE = 100;
const markdownCache = new Map<string, string>();
const cacheKeys: string[] = [];

function getCached(key: string): string | undefined {
  return markdownCache.get(key);
}

function setCached(key: string, value: string): void {
  if (markdownCache.size >= MAX_CACHE_SIZE && !markdownCache.has(key)) {
    const oldest = cacheKeys.shift();
    if (oldest != null) markdownCache.delete(oldest);
  }
  if (!markdownCache.has(key)) cacheKeys.push(key);
  markdownCache.set(key, value);
}

// Configure marked with terminal renderer (width read at render time via cache key)
marked.use(
  markedTerminal({
    reflowText: true,
    width: Math.min(process.stdout.columns || 80, 120),
    showSectionPrefix: false,
    tab: 2,
  }) as any
);

const MAX_CONTENT_CACHE = 8000; // Only cache content up to this length to limit memory

export function renderMarkdown(content: string): string {
  if (!content) return '';
  const useCache = content.length <= MAX_CONTENT_CACHE;
  if (useCache) {
    const cached = getCached(content);
    if (cached !== undefined) return cached;
  }
  try {
    const rendered = marked.parse(content) as string;
    const out = rendered.replace(/\n{3,}/g, '\n\n').trim();
    if (useCache) setCached(content, out);
    return out;
  } catch {
    return content;
  }
}
