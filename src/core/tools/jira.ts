import type { ToolDefinition, ToolResult } from './types.js';
import { JiraClient, type JiraConfig } from '../integrations/jira-client.js';

let jiraClient: JiraClient | null = null;

export function setJiraConfig(config: JiraConfig): void {
  jiraClient = new JiraClient(config);
}

export function isJiraConfigured(): boolean {
  return jiraClient !== null;
}

export const jiraTool: ToolDefinition = {
  name: 'jira',
  description: `Interact with Jira for ticket management. Actions:
- getTicket: Get full ticket details (includes attachment list). Params: { ticketId: "PROJ-123" }
- listTickets: List tickets by project/status. Params: { project: "PROJ", status?: "To Do" }
- updateStatus: Transition a ticket to a new status. Params: { ticketId: "PROJ-123", status: "In Progress" }
- addComment: Add a comment to a ticket. Params: { ticketId: "PROJ-123", comment: "Started working on this" }
- getComments: Get all comments on a ticket. Params: { ticketId: "PROJ-123" }
- getAttachments: List all attachments on a ticket. Params: { ticketId: "PROJ-123" }
- downloadAttachment: Download and read an attachment's content (text, JSON, images, PDFs). Params: { ticketId: "PROJ-123", filename: "spec.json" }`,
  category: 'execute',
  parameters: {
    type: 'object',
    properties: {
      action: {
        type: 'string',
        description: 'The Jira action to perform',
        enum: ['getTicket', 'listTickets', 'updateStatus', 'addComment', 'getComments', 'getAttachments', 'downloadAttachment'],
      },
      params: {
        type: 'string',
        description: 'JSON string of action parameters',
      },
    },
    required: ['action'],
  },
};

export async function executeJira(args: Record<string, unknown>): Promise<ToolResult> {
  const start = Date.now();
  const action = args.action as string;

  if (!jiraClient) {
    return {
      name: 'jira',
      success: false,
      output: 'Jira not configured. Use /setup jira <url> <email> <token> to configure.',
      duration: Date.now() - start,
    };
  }

  let params: Record<string, unknown> = {};
  if (args.params) {
    try {
      params = typeof args.params === 'string' ? JSON.parse(args.params) : args.params as Record<string, unknown>;
    } catch {
      return { name: 'jira', success: false, output: 'Invalid params JSON.', duration: Date.now() - start };
    }
  }

  try {
    switch (action) {
      case 'getTicket': {
        if (!params.ticketId) return fail('getTicket requires ticketId', start);
        const ticket = await jiraClient.getTicket(params.ticketId as string);
        return ok(JSON.stringify(ticket, null, 2), start);
      }
      case 'listTickets': {
        if (!params.project) return fail('listTickets requires project', start);
        const tickets = await jiraClient.listTickets(
          params.project as string,
          params.status as string | undefined,
        );
        return ok(JSON.stringify(tickets, null, 2), start);
      }
      case 'updateStatus': {
        if (!params.ticketId || !params.status) return fail('updateStatus requires ticketId and status', start);
        await jiraClient.updateTicketStatus(params.ticketId as string, params.status as string);
        return ok(`Ticket ${params.ticketId} transitioned to "${params.status}"`, start);
      }
      case 'addComment': {
        if (!params.ticketId || !params.comment) return fail('addComment requires ticketId and comment', start);
        await jiraClient.addComment(params.ticketId as string, params.comment as string);
        return ok(`Comment added to ${params.ticketId}`, start);
      }
      case 'getComments': {
        if (!params.ticketId) return fail('getComments requires ticketId', start);
        const comments = await jiraClient.getComments(params.ticketId as string);
        return ok(JSON.stringify(comments, null, 2), start);
      }
      case 'getAttachments': {
        if (!params.ticketId) return fail('getAttachments requires ticketId', start);
        const attachments = await jiraClient.getAttachments(params.ticketId as string);
        if (attachments.length === 0) {
          return ok('No attachments found on this ticket.', start);
        }
        const summary = attachments.map((a) =>
          `- ${a.filename} (${a.mimeType}, ${formatBytes(a.size)}) by ${a.author} on ${a.created}`
        ).join('\n');
        return ok(`${attachments.length} attachment(s):\n${summary}`, start);
      }
      case 'downloadAttachment': {
        if (!params.ticketId) return fail('downloadAttachment requires ticketId', start);
        if (!params.filename) return fail('downloadAttachment requires filename', start);
        // First get attachments to find the content URL
        const allAttachments = await jiraClient.getAttachments(params.ticketId as string);
        const target = allAttachments.find((a) =>
          a.filename.toLowerCase() === (params.filename as string).toLowerCase()
        );
        if (!target) {
          const available = allAttachments.map((a) => a.filename).join(', ');
          return fail(`Attachment "${params.filename}" not found. Available: ${available || 'none'}`, start);
        }
        const content = await jiraClient.downloadAttachment(target.contentUrl, target.mimeType, target.filename, target.size);
        return ok(content, start);
      }
      default:
        return fail(`Unknown jira action: ${action}`, start);
    }
  } catch (err) {
    return {
      name: 'jira',
      success: false,
      output: `Jira action failed: ${err instanceof Error ? err.message : 'Unknown error'}`,
      duration: Date.now() - start,
    };
  }
}

function ok(output: string, start: number): ToolResult {
  return { name: 'jira', success: true, output, duration: Date.now() - start };
}

function fail(message: string, start: number): ToolResult {
  return { name: 'jira', success: false, output: message, duration: Date.now() - start };
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
