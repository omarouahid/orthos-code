import type { PermissionConfig } from './tools/types.js';
import { DEFAULT_PERMISSIONS } from './tools/types.js';
import { getToolCategory } from './tools/index.js';

let currentPermissions: PermissionConfig = { ...DEFAULT_PERMISSIONS };
let adminMode = false;
let pendingApproval: { resolve: (approved: boolean) => void } | null = null;

export function setAdminMode(enabled: boolean): void {
  adminMode = enabled;
}

export function isAdminMode(): boolean {
  return adminMode;
}

export function getPermissions(): PermissionConfig {
  return currentPermissions;
}

export function setPermissions(config: Partial<PermissionConfig>): void {
  currentPermissions = { ...currentPermissions, ...config };
}

export function setYoloMode(enabled: boolean): void {
  currentPermissions.yolo = enabled;
}

export function isYoloMode(): boolean {
  return currentPermissions.yolo;
}

export type PermissionDecision = 'allowed' | 'needs_approval' | 'denied';

export function checkPermission(toolName: string): PermissionDecision {
  if (adminMode) return 'allowed';
  if (currentPermissions.yolo) return 'allowed';

  const category = getToolCategory(toolName);
  const level = currentPermissions[category];

  switch (level) {
    case 'allow': return 'allowed';
    case 'ask': return 'needs_approval';
    case 'deny': return 'denied';
    default: return 'needs_approval';
  }
}

// For interactive approval
export function requestApproval(): Promise<boolean> {
  return new Promise((resolve) => {
    pendingApproval = { resolve };
  });
}

export function resolveApproval(approved: boolean): void {
  if (pendingApproval) {
    pendingApproval.resolve(approved);
    pendingApproval = null;
  }
}

export function hasPendingApproval(): boolean {
  return pendingApproval !== null;
}
