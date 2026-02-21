/**
 * Jira REST API v3 client (fetch-based, no external dependencies)
 */

export interface JiraConfig {
  baseUrl: string;   // e.g. https://company.atlassian.net
  email: string;     // Jira account email
  apiToken: string;  // Jira API token
}

export interface JiraAttachment {
  id: string;
  filename: string;
  mimeType: string;
  size: number;
  created: string;
  author: string;
  contentUrl: string;
}

export interface JiraTicket {
  key: string;
  summary: string;
  description: string;
  status: string;
  assignee: string | null;
  reporter: string | null;
  priority: string;
  type: string;
  labels: string[];
  subtasks: Array<{ key: string; summary: string; status: string }>;
  acceptanceCriteria: string;
  comments: JiraComment[];
  attachments: JiraAttachment[];
}

export interface JiraComment {
  author: string;
  body: string;
  created: string;
}

export interface JiraTicketSummary {
  key: string;
  summary: string;
  status: string;
  assignee: string | null;
  priority: string;
  type: string;
}

export class JiraClient {
  private baseUrl: string;
  private authHeader: string;

  constructor(config: JiraConfig) {
    this.baseUrl = config.baseUrl.replace(/\/$/, '');
    this.authHeader = 'Basic ' + Buffer.from(`${config.email}:${config.apiToken}`).toString('base64');
  }

  private async request(path: string, method = 'GET', body?: unknown): Promise<unknown> {
    const url = `${this.baseUrl}/rest/api/3${path}`;
    const headers: Record<string, string> = {
      'Authorization': this.authHeader,
      'Content-Type': 'application/json',
      'Accept': 'application/json',
    };

    const response = await fetch(url, {
      method,
      headers,
      body: body ? JSON.stringify(body) : undefined,
    });

    if (!response.ok) {
      const text = await response.text();
      throw new Error(`Jira API error (${response.status}): ${text}`);
    }

    return response.json();
  }

  async getTicket(ticketId: string): Promise<JiraTicket> {
    const data = await this.request(`/issue/${ticketId}?expand=renderedFields`) as Record<string, unknown>;
    const fields = data.fields as Record<string, unknown>;

    // Extract description text from Atlassian Document Format
    const description = extractAdfText(fields.description);
    const acceptanceCriteria = extractCustomField(fields, 'acceptance criteria') || '';

    // Get comments
    const commentData = (fields.comment as Record<string, unknown>)?.comments as Array<Record<string, unknown>> || [];
    const comments: JiraComment[] = commentData.map((c) => ({
      author: (c.author as Record<string, unknown>)?.displayName as string || 'Unknown',
      body: extractAdfText(c.body),
      created: c.created as string || '',
    }));

    // Get subtasks
    const subtaskData = (fields.subtasks as Array<Record<string, unknown>>) || [];
    const subtasks = subtaskData.map((s) => ({
      key: s.key as string,
      summary: (s.fields as Record<string, unknown>)?.summary as string || '',
      status: ((s.fields as Record<string, unknown>)?.status as Record<string, unknown>)?.name as string || '',
    }));

    // Get attachments
    const attachmentData = (fields.attachment as Array<Record<string, unknown>>) || [];
    const attachments: JiraAttachment[] = attachmentData.map((a) => ({
      id: a.id as string,
      filename: a.filename as string || '',
      mimeType: a.mimeType as string || 'application/octet-stream',
      size: a.size as number || 0,
      created: a.created as string || '',
      author: (a.author as Record<string, unknown>)?.displayName as string || 'Unknown',
      contentUrl: a.content as string || '',
    }));

    return {
      key: data.key as string,
      summary: fields.summary as string || '',
      description,
      status: (fields.status as Record<string, unknown>)?.name as string || '',
      assignee: (fields.assignee as Record<string, unknown>)?.displayName as string || null,
      reporter: (fields.reporter as Record<string, unknown>)?.displayName as string || null,
      priority: (fields.priority as Record<string, unknown>)?.name as string || 'Medium',
      type: (fields.issuetype as Record<string, unknown>)?.name as string || 'Task',
      labels: (fields.labels as string[]) || [],
      subtasks,
      acceptanceCriteria,
      comments,
      attachments,
    };
  }

  async listTickets(project: string, status?: string, maxResults = 20): Promise<JiraTicketSummary[]> {
    let jql = `project = "${project}"`;
    if (status) jql += ` AND status = "${status}"`;
    jql += ' ORDER BY updated DESC';

    const data = await this.request(`/search?jql=${encodeURIComponent(jql)}&maxResults=${maxResults}&fields=summary,status,assignee,priority,issuetype`) as Record<string, unknown>;
    const issues = (data.issues as Array<Record<string, unknown>>) || [];

    return issues.map((issue) => {
      const fields = issue.fields as Record<string, unknown>;
      return {
        key: issue.key as string,
        summary: fields.summary as string || '',
        status: (fields.status as Record<string, unknown>)?.name as string || '',
        assignee: (fields.assignee as Record<string, unknown>)?.displayName as string || null,
        priority: (fields.priority as Record<string, unknown>)?.name as string || 'Medium',
        type: (fields.issuetype as Record<string, unknown>)?.name as string || 'Task',
      };
    });
  }

  async updateTicketStatus(ticketId: string, transitionName: string): Promise<void> {
    // First get available transitions
    const transData = await this.request(`/issue/${ticketId}/transitions`) as Record<string, unknown>;
    const transitions = (transData.transitions as Array<Record<string, unknown>>) || [];
    const transition = transitions.find((t) =>
      (t.name as string).toLowerCase() === transitionName.toLowerCase()
    );
    if (!transition) {
      const available = transitions.map((t) => t.name).join(', ');
      throw new Error(`Transition "${transitionName}" not found. Available: ${available}`);
    }
    await this.request(`/issue/${ticketId}/transitions`, 'POST', {
      transition: { id: transition.id },
    });
  }

  async addComment(ticketId: string, comment: string): Promise<void> {
    await this.request(`/issue/${ticketId}/comment`, 'POST', {
      body: {
        type: 'doc',
        version: 1,
        content: [{
          type: 'paragraph',
          content: [{ type: 'text', text: comment }],
        }],
      },
    });
  }

  async getComments(ticketId: string): Promise<JiraComment[]> {
    const data = await this.request(`/issue/${ticketId}/comment`) as Record<string, unknown>;
    const comments = (data.comments as Array<Record<string, unknown>>) || [];
    return comments.map((c) => ({
      author: (c.author as Record<string, unknown>)?.displayName as string || 'Unknown',
      body: extractAdfText(c.body),
      created: c.created as string || '',
    }));
  }

  /** List attachments for a ticket */
  async getAttachments(ticketId: string): Promise<JiraAttachment[]> {
    const data = await this.request(`/issue/${ticketId}?fields=attachment`) as Record<string, unknown>;
    const fields = data.fields as Record<string, unknown>;
    const attachmentData = (fields.attachment as Array<Record<string, unknown>>) || [];
    return attachmentData.map((a) => ({
      id: a.id as string,
      filename: a.filename as string || '',
      mimeType: a.mimeType as string || 'application/octet-stream',
      size: a.size as number || 0,
      created: a.created as string || '',
      author: (a.author as Record<string, unknown>)?.displayName as string || 'Unknown',
      contentUrl: a.content as string || '',
    }));
  }

  /**
   * Download an attachment's content.
   * - Text-based files (JSON, TXT, CSV, MD, XML, HTML, YAML, etc.) → returns the text content directly
   * - Images (PNG, JPG, GIF, SVG, WEBP) → returns base64-encoded data with mime prefix
   * - PDFs and other binary files → returns a description with metadata (too large to inline)
   */
  async downloadAttachment(contentUrl: string, mimeType: string, filename: string, fileSize?: number): Promise<string> {
    // Pre-check: reject very large files before downloading
    const MAX_DOWNLOAD_SIZE = 20 * 1024 * 1024; // 20MB
    if (fileSize && fileSize > MAX_DOWNLOAD_SIZE) {
      return `[File: ${filename}] (${formatSize(fileSize)}) — too large to download (max ${formatSize(MAX_DOWNLOAD_SIZE)}). Access it directly in Jira.`;
    }

    const response = await fetch(contentUrl, {
      headers: { 'Authorization': this.authHeader },
    });

    if (!response.ok) {
      throw new Error(`Failed to download attachment (${response.status}): ${response.statusText}`);
    }

    // Text-based files — return content directly
    const textTypes = [
      'application/json', 'text/plain', 'text/csv', 'text/markdown',
      'text/xml', 'application/xml', 'text/html', 'text/yaml',
      'application/x-yaml', 'text/x-yaml',
    ];
    const textExtensions = ['.json', '.txt', '.csv', '.md', '.xml', '.html', '.yaml', '.yml', '.log', '.env', '.ts', '.js', '.py', '.java', '.go', '.rs', '.sql', '.sh', '.bat', '.cfg', '.ini', '.toml'];
    const ext = filename.toLowerCase().substring(filename.lastIndexOf('.'));
    const isText = textTypes.some((t) => mimeType.startsWith(t)) || textExtensions.includes(ext);

    if (isText) {
      const text = await response.text();
      // Limit text size to avoid overloading context
      if (text.length > 50000) {
        return `[File: ${filename}] (${formatSize(text.length)} — truncated to first 50,000 chars)\n\n${text.slice(0, 50000)}\n\n... [truncated]`;
      }
      return `[File: ${filename}]\n\n${text}`;
    }

    // Images — return base64 for the LLM to analyze
    const imageTypes = ['image/png', 'image/jpeg', 'image/jpg', 'image/gif', 'image/svg+xml', 'image/webp'];
    if (imageTypes.some((t) => mimeType.startsWith(t))) {
      const buffer = Buffer.from(await response.arrayBuffer());
      // Limit image size (5MB max for base64 inlining)
      if (buffer.length > 5 * 1024 * 1024) {
        return `[Image: ${filename}] (${formatSize(buffer.length)} — too large to inline. Size exceeds 5MB limit.)`;
      }
      const base64 = buffer.toString('base64');
      return `[Image: ${filename}] (${formatSize(buffer.length)})\ndata:${mimeType};base64,${base64}`;
    }

    // PDF — extract what we can
    if (mimeType === 'application/pdf') {
      const buffer = Buffer.from(await response.arrayBuffer());
      // Try basic text extraction from PDF (look for text streams)
      const pdfText = extractBasicPdfText(buffer);
      if (pdfText.length > 100) {
        const truncated = pdfText.length > 50000 ? pdfText.slice(0, 50000) + '\n\n... [truncated]' : pdfText;
        return `[PDF: ${filename}] (${formatSize(buffer.length)}) — extracted text:\n\n${truncated}`;
      }
      return `[PDF: ${filename}] (${formatSize(buffer.length)}) — could not extract readable text. The PDF may contain scanned images. Consider using the browser tool to view it.`;
    }

    // Other binary files — just metadata
    const buffer = Buffer.from(await response.arrayBuffer());
    return `[Binary file: ${filename}] (${formatSize(buffer.length)}, type: ${mimeType}) — binary content cannot be displayed inline.`;
  }
}

/** Extract plain text from Atlassian Document Format (handles all common node types) */
function extractAdfText(adf: unknown, indent = ''): string {
  if (!adf || typeof adf !== 'object') return String(adf || '');
  const node = adf as Record<string, unknown>;

  switch (node.type) {
    case 'text':
      return node.text as string || '';

    case 'hardBreak':
      return '\n';

    case 'mention':
      return `@${(node.attrs as Record<string, unknown>)?.text || 'user'}`;

    case 'emoji':
      return (node.attrs as Record<string, unknown>)?.shortName as string || '';

    case 'inlineCard':
    case 'blockCard':
      return (node.attrs as Record<string, unknown>)?.url as string || '';

    case 'heading': {
      const level = (node.attrs as Record<string, unknown>)?.level as number || 1;
      const prefix = '#'.repeat(level) + ' ';
      const content = node.content as Array<Record<string, unknown>>;
      return prefix + (content ? content.map((c) => extractAdfText(c, indent)).join('') : '') + '\n';
    }

    case 'paragraph': {
      const content = node.content as Array<Record<string, unknown>>;
      if (!Array.isArray(content)) return '\n';
      return content.map((c) => extractAdfText(c, indent)).join('') + '\n';
    }

    case 'bulletList': {
      const items = node.content as Array<Record<string, unknown>>;
      if (!Array.isArray(items)) return '';
      return items.map((item) => {
        const itemContent = item.content as Array<Record<string, unknown>>;
        if (!Array.isArray(itemContent)) return `${indent}- \n`;
        return itemContent.map((c) => `${indent}- ${extractAdfText(c, indent + '  ').trim()}`).join('\n');
      }).join('\n') + '\n';
    }

    case 'orderedList': {
      const items = node.content as Array<Record<string, unknown>>;
      if (!Array.isArray(items)) return '';
      return items.map((item, i) => {
        const itemContent = item.content as Array<Record<string, unknown>>;
        if (!Array.isArray(itemContent)) return `${indent}${i + 1}. \n`;
        return itemContent.map((c) => `${indent}${i + 1}. ${extractAdfText(c, indent + '   ').trim()}`).join('\n');
      }).join('\n') + '\n';
    }

    case 'listItem': {
      const content = node.content as Array<Record<string, unknown>>;
      if (!Array.isArray(content)) return '';
      return content.map((c) => extractAdfText(c, indent)).join('');
    }

    case 'codeBlock': {
      const lang = (node.attrs as Record<string, unknown>)?.language || '';
      const content = node.content as Array<Record<string, unknown>>;
      const code = content ? content.map((c) => extractAdfText(c, indent)).join('') : '';
      return `\`\`\`${lang}\n${code}\`\`\`\n`;
    }

    case 'blockquote': {
      const content = node.content as Array<Record<string, unknown>>;
      if (!Array.isArray(content)) return '';
      const text = content.map((c) => extractAdfText(c, indent)).join('');
      return text.split('\n').map((line) => `> ${line}`).join('\n') + '\n';
    }

    case 'table': {
      const rows = node.content as Array<Record<string, unknown>>;
      if (!Array.isArray(rows)) return '';
      return rows.map((row) => {
        const cells = row.content as Array<Record<string, unknown>>;
        if (!Array.isArray(cells)) return '';
        const cellTexts = cells.map((cell) => {
          const cellContent = cell.content as Array<Record<string, unknown>>;
          return cellContent ? cellContent.map((c) => extractAdfText(c, indent)).join('').trim() : '';
        });
        return '| ' + cellTexts.join(' | ') + ' |';
      }).join('\n') + '\n';
    }

    case 'rule':
      return '---\n';

    case 'mediaGroup':
    case 'mediaSingle': {
      const media = node.content as Array<Record<string, unknown>>;
      if (!Array.isArray(media)) return '[media]\n';
      return media.map((m) => {
        const attrs = m.attrs as Record<string, unknown>;
        return `[attachment: ${attrs?.alt || attrs?.id || 'media'}]`;
      }).join('\n') + '\n';
    }

    default: {
      // Generic fallback: recurse into content array
      const content = node.content as Array<Record<string, unknown>>;
      if (!Array.isArray(content)) return '';
      return content.map((c) => extractAdfText(c, indent)).join('');
    }
  }
}

/** Try to find acceptance criteria in custom fields */
function extractCustomField(fields: Record<string, unknown>, name: string): string {
  for (const [key, value] of Object.entries(fields)) {
    if (key.startsWith('customfield_') && value) {
      const text = extractAdfText(value);
      if (text.toLowerCase().includes(name)) return text;
    }
  }
  return '';
}

/** Format bytes into human-readable size */
function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/** Basic text extraction from PDF buffers (no external deps) */
function extractBasicPdfText(buffer: Buffer): string {
  const text = buffer.toString('latin1');
  const textParts: string[] = [];

  // Extract text between BT (begin text) and ET (end text) operators
  const btEtRegex = /BT\s([\s\S]*?)ET/g;
  let match;
  while ((match = btEtRegex.exec(text)) !== null) {
    const block = match[1];
    // Extract text from Tj and TJ operators
    const tjRegex = /\(([^)]*)\)\s*Tj/g;
    let tjMatch;
    while ((tjMatch = tjRegex.exec(block)) !== null) {
      textParts.push(tjMatch[1]);
    }
    // TJ array: [(text) num (text) ...]
    const tjArrayRegex = /\[([^\]]*)\]\s*TJ/g;
    let arrMatch;
    while ((arrMatch = tjArrayRegex.exec(block)) !== null) {
      const inner = arrMatch[1];
      const strRegex = /\(([^)]*)\)/g;
      let strMatch;
      while ((strMatch = strRegex.exec(inner)) !== null) {
        textParts.push(strMatch[1]);
      }
    }
  }

  return textParts
    .join(' ')
    .replace(/\\n/g, '\n')
    .replace(/\\r/g, '')
    .replace(/\\t/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}
