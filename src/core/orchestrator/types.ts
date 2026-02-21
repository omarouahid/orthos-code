export type AgentRole = 'coder' | 'researcher' | 'reviewer';

export type ExecutionMode = 'sequential' | 'parallel';

export interface AgentTask {
  id: string;
  role: AgentRole;
  stepId: number;
  description: string;
  status: 'pending' | 'running' | 'completed' | 'failed';
  result?: string;
  model?: string;
  startedAt?: number;
  completedAt?: number;
}

export interface OrchestrationSession {
  active: boolean;
  executionMode: ExecutionMode;
  tasks: AgentTask[];
  coderModel?: string;
}

export interface ComplexityAnalysis {
  isComplex: boolean;
  reason: string;
  suggestedSteps: number;
  involvedFiles: number;
  hasMultipleTasks: boolean;
}

export interface AgentProgressEvent {
  taskId: string;
  role: AgentRole;
  status: AgentTask['status'];
  stepId: number;
  detail?: string;
}
