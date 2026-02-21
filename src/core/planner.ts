import { EventEmitter } from 'events';
import type { Plan, PlanStep } from '../types/index.js';
import type { ToolDefinition, ToolResult } from './tools/types.js';

// Node.js event emitter for plan updates (replaces browser window.dispatchEvent)
export const planEvents = new EventEmitter();
planEvents.setMaxListeners(20);

// --- Tool Definitions ---

export const createPlanTool: ToolDefinition = {
  name: 'create_plan',
  description: 'Create a step-by-step plan for a medium or large task. The plan will be shown to the user for approval before execution. Use this when: the user gives multiple tasks or a list of items (so you do not forget any); multi-file changes; refactoring; new features; or complex debugging. Each user-requested item should be its own step so you work through all of them.',
  category: 'read',
  parameters: {
    type: 'object',
    properties: {
      title: {
        type: 'string',
        description: 'Short title describing the overall task',
      },
      steps: {
        type: 'string',
        description: 'JSON array of steps, each with "title" and "description" fields. Example: [{"title":"Read auth files","description":"Examine current authentication implementation"},{"title":"Refactor middleware","description":"Extract shared auth logic into middleware"}]',
      },
    },
    required: ['title', 'steps'],
  },
};

export const updatePlanStepTool: ToolDefinition = {
  name: 'update_plan_step',
  description: 'Update the status of a plan step. Call this to mark a step as in_progress when you start working on it, completed when done, or failed if it cannot be completed.',
  category: 'read',
  parameters: {
    type: 'object',
    properties: {
      step_id: {
        type: 'string',
        description: 'The step number (1-based)',
      },
      status: {
        type: 'string',
        description: 'New status for the step',
        enum: ['in_progress', 'completed', 'failed'],
      },
    },
    required: ['step_id', 'status'],
  },
};

// --- Plan State Management ---

let currentPlan: Plan | null = null;
let stepStartTimes: Map<number, number> = new Map();

export function getCurrentPlan(): Plan | null {
  return currentPlan;
}

export function setCurrentPlan(plan: Plan): void {
  currentPlan = plan;
  stepStartTimes = new Map();
}

export function clearPlan(): void {
  currentPlan = null;
  stepStartTimes = new Map();
}

export function updateStepStatus(stepId: number, status: PlanStep['status']): boolean {
  if (!currentPlan) return false;

  const step = currentPlan.steps.find((s) => s.id === stepId);
  if (!step) return false;

  if (status === 'in_progress') {
    stepStartTimes.set(stepId, Date.now());
  }

  if (status === 'completed' || status === 'failed') {
    const startTime = stepStartTimes.get(stepId);
    if (startTime) {
      step.duration = Date.now() - startTime;
    }
  }

  step.status = status;

  // Emit event for UI updates via Node.js EventEmitter
  planEvents.emit('planStepUpdated', { plan: currentPlan, stepId, status });

  return true;
}

export function approvePlan(): void {
  if (currentPlan) {
    currentPlan.approved = true;
  }
}

export function getPlanProgress(): { completed: number; total: number; current: string | null } {
  if (!currentPlan) return { completed: 0, total: 0, current: null };

  const completed = currentPlan.steps.filter((s) => s.status === 'completed').length;
  const activeStep = currentPlan.steps.find((s) => s.status === 'in_progress');

  return {
    completed,
    total: currentPlan.steps.length,
    current: activeStep?.title || null,
  };
}

// --- Tool Executors ---

export function executeCreatePlan(args: Record<string, unknown>): ToolResult {
  const start = Date.now();

  try {
    const title = args.title as string;
    let stepsRaw = args.steps;

    // Parse steps - could be string (JSON) or already an array
    let stepsArray: Array<{ title: string; description: string }>;
    if (typeof stepsRaw === 'string') {
      stepsArray = JSON.parse(stepsRaw);
    } else if (Array.isArray(stepsRaw)) {
      stepsArray = stepsRaw as Array<{ title: string; description: string }>;
    } else {
      return {
        name: 'create_plan',
        success: false,
        output: 'Invalid steps format. Provide a JSON array of {title, description} objects.',
        duration: Date.now() - start,
      };
    }

    const plan: Plan = {
      title,
      steps: stepsArray.map((s, i) => ({
        id: i + 1,
        title: s.title,
        description: s.description || '',
        status: 'pending' as const,
      })),
      approved: false,
      createdAt: Date.now(),
    };

    setCurrentPlan(plan);

    return {
      name: 'create_plan',
      success: true,
      output: `Plan created: "${title}" with ${plan.steps.length} steps. Waiting for user approval.`,
      duration: Date.now() - start,
    };
  } catch (err) {
    return {
      name: 'create_plan',
      success: false,
      output: `Failed to create plan: ${err instanceof Error ? err.message : 'Unknown error'}`,
      duration: Date.now() - start,
    };
  }
}

export function executeUpdatePlanStep(args: Record<string, unknown>): ToolResult {
  const start = Date.now();
  const stepId = parseInt(String(args.step_id), 10);
  const status = args.status as PlanStep['status'];

  if (isNaN(stepId) || !status) {
    return {
      name: 'update_plan_step',
      success: false,
      output: 'Invalid step_id or status.',
      duration: Date.now() - start,
    };
  }

  if (currentPlan && (stepId < 1 || stepId > currentPlan.steps.length)) {
    return {
      name: 'update_plan_step',
      success: false,
      output: `Step ${stepId} out of range. Plan has ${currentPlan.steps.length} steps (1-${currentPlan.steps.length}).`,
      duration: Date.now() - start,
    };
  }

  const updated = updateStepStatus(stepId, status);
  if (!updated) {
    return {
      name: 'update_plan_step',
      success: false,
      output: `Step ${stepId} not found or no active plan.`,
      duration: Date.now() - start,
    };
  }

  const progress = getPlanProgress();
  return {
    name: 'update_plan_step',
    success: true,
    output: `Step ${stepId} marked as ${status}. Progress: ${progress.completed}/${progress.total}`,
    duration: Date.now() - start,
  };
}
