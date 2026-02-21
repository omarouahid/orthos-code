export interface SkillDefinition {
  id: string;
  name: string;
  description: string;
  requiredTools: string[];     // Tools the skill needs (e.g., ['browser', 'jira', 'github'])
  configSchema?: Record<string, {
    type: string;
    description: string;
    required?: boolean;
    default?: unknown;
  }>;
}

export interface SkillInstance {
  definition: SkillDefinition;
  config: Record<string, unknown>;
  instructions: string;        // Content of SKILL.md — injected into system prompt
}
