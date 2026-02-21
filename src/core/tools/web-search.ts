import type { ToolDefinition, ToolResult } from './types.js';

export const webSearchTool: ToolDefinition = {
  name: 'web_search',
  description: 'Search the web for documentation, error solutions, API references, tutorials, and other information. Returns top results with titles, URLs, and snippets.',
  category: 'read',
  parameters: {
    type: 'object',
    properties: {
      query: {
        type: 'string',
        description: 'The search query',
      },
    },
    required: ['query'],
  },
};

export function executeWebSearch(args: Record<string, unknown>, _cwd: string): ToolResult {
  const start = Date.now();
  const query = args.query as string;

  if (!query?.trim()) {
    return {
      name: 'web_search',
      success: false,
      output: 'Search query is required.',
      duration: Date.now() - start,
    };
  }

  // Use synchronous approach via execSync to call curl/fetch
  // since the tool executor interface is synchronous
  try {
    const { execSync } = require('node:child_process');
    const encodedQuery = encodeURIComponent(query);
    const url = `https://html.duckduckgo.com/html/?q=${encodedQuery}`;

    // Use curl to fetch the HTML
    const html = execSync(
      `curl -s -L -A "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36" "${url}"`,
      { encoding: 'utf-8', timeout: 15000, maxBuffer: 1024 * 1024 }
    );

    // Parse results from DuckDuckGo HTML
    const results = parseDuckDuckGoResults(html);

    if (results.length === 0) {
      return {
        name: 'web_search',
        success: true,
        output: `No results found for: "${query}"`,
        duration: Date.now() - start,
      };
    }

    const formatted = results
      .slice(0, 5)
      .map((r, i) => `${i + 1}. ${r.title}\n   ${r.url}\n   ${r.snippet}`)
      .join('\n\n');

    return {
      name: 'web_search',
      success: true,
      output: `Search results for "${query}":\n\n${formatted}`,
      duration: Date.now() - start,
    };
  } catch (err) {
    return {
      name: 'web_search',
      success: false,
      output: `Search failed: ${err instanceof Error ? err.message : 'Unknown error'}`,
      duration: Date.now() - start,
    };
  }
}

interface SearchResult {
  title: string;
  url: string;
  snippet: string;
}

function parseDuckDuckGoResults(html: string): SearchResult[] {
  const results: SearchResult[] = [];

  // Match result blocks - DuckDuckGo HTML uses class="result__a" for links
  // and class="result__snippet" for snippets
  const linkRegex = /<a[^>]*class="result__a"[^>]*href="([^"]*)"[^>]*>(.*?)<\/a>/gi;
  const snippetRegex = /<a[^>]*class="result__snippet"[^>]*>(.*?)<\/a>/gi;

  const links: Array<{ url: string; title: string }> = [];
  let match;

  while ((match = linkRegex.exec(html)) !== null) {
    const rawUrl = match[1];
    const title = stripHtml(match[2]);

    // DuckDuckGo wraps URLs in a redirect - extract the actual URL
    let url = rawUrl;
    const uddgMatch = rawUrl.match(/uddg=([^&]+)/);
    if (uddgMatch) {
      url = decodeURIComponent(uddgMatch[1]);
    }

    if (title && url && !url.includes('duckduckgo.com')) {
      links.push({ url, title });
    }
  }

  const snippets: string[] = [];
  while ((match = snippetRegex.exec(html)) !== null) {
    snippets.push(stripHtml(match[1]));
  }

  for (let i = 0; i < links.length && i < 5; i++) {
    results.push({
      title: links[i].title,
      url: links[i].url,
      snippet: snippets[i] || '',
    });
  }

  return results;
}

function stripHtml(html: string): string {
  return html
    .replace(/<[^>]*>/g, '')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}
