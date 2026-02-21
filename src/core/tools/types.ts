export interface ToolDefinition {
  name: string;
  description: string;
  category: 'read' | 'write' | 'execute' | 'search' | 'git';
  parameters: {
    type: 'object';
    properties: Record<string, { type: string; description: string; enum?: string[] }>;
    required: string[];
  };
}

export interface ToolCall {
  function: {
    name: string;
    arguments: Record<string, unknown>;
  };
}

export interface ToolResult {
  name: string;
  success: boolean;
  output: string;
  diff?: string; // For write/edit operations
  duration: number; // ms
}

export type PermissionLevel = 'allow' | 'ask' | 'deny';

export interface PermissionConfig {
  read: PermissionLevel;
  write: PermissionLevel;
  execute: PermissionLevel;
  search: PermissionLevel;
  git: PermissionLevel;
  yolo: boolean; // Auto-accept everything
}

export const DEFAULT_PERMISSIONS: PermissionConfig = {
  read: 'allow',
  write: 'ask',
  execute: 'ask',
  search: 'allow',
  git: 'ask',
  yolo: false,
};
