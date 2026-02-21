import { readFileSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import type { SkillDefinition, SkillInstance } from './types.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Resolve skills directory relative to this file (src/core/skills → src/skills)
const SKILLS_DIR = join(__dirname, '..', '..', 'skills');

let activeSkill: SkillInstance | null = null;

/** List all available skills by scanning the skills directory */
export function listSkills(): SkillDefinition[] {
  const skills: SkillDefinition[] = [];

  // Built-in skill definitions (since we bundle with tsup, read at build time)
  const builtinSkills: SkillDefinition[] = [
    {
      id: 'linkedin-apply',
      name: 'LinkedIn Auto-Apply',
      description: 'Automatically apply to jobs on LinkedIn using the browser extension',
      requiredTools: ['browser'],
      configSchema: {
        jobTitle: { type: 'string', description: 'Target job title to search for', required: true },
        location: { type: 'string', description: 'Job location', required: false, default: '' },
        resumePath: { type: 'string', description: 'Path to resume file', required: false },
      },
    },
    {
      id: 'jira-to-pr',
      name: 'Jira Ticket → Pull Request',
      description: 'Read a Jira ticket, implement the requirements, write tests, and create a PR',
      requiredTools: ['jira', 'github'],
      configSchema: {
        ticketId: { type: 'string', description: 'Jira ticket ID (e.g., PROJ-123)', required: true },
        baseBranch: { type: 'string', description: 'Base branch for PR', required: false, default: 'main' },
        branchNaming: { type: 'string', description: 'Branch naming pattern. Use {type}, {ticket}, {name} placeholders (e.g. "feature/{ticket}-{name}" or "fix/{ticket}"). Default: "{type}/{ticket}-{name}"', required: false, default: '{type}/{ticket}-{name}' },
      },
    },
  ];

  return builtinSkills;
}

/** Load a skill by ID with the given configuration */
export function loadSkill(id: string, config: Record<string, unknown> = {}): SkillInstance | null {
  const skills = listSkills();
  const definition = skills.find((s) => s.id === id);
  if (!definition) return null;

  // Try to load SKILL.md instructions
  let instructions = '';
  const skillMdPath = join(SKILLS_DIR, id, 'SKILL.md');
  if (existsSync(skillMdPath)) {
    instructions = readFileSync(skillMdPath, 'utf-8');
  } else {
    // Use fallback instructions
    instructions = getDefaultInstructions(id, config);
  }

  // Inject config values into instructions
  for (const [key, value] of Object.entries(config)) {
    instructions = instructions.replace(new RegExp(`\\{\\{${key}\\}\\}`, 'g'), String(value));
  }

  const instance: SkillInstance = { definition, config, instructions };
  activeSkill = instance;
  return instance;
}

/** Get the currently active skill */
export function getActiveSkill(): SkillInstance | null {
  return activeSkill;
}

/** Deactivate the current skill */
export function deactivateSkill(): void {
  activeSkill = null;
}

/** Get system prompt addition for the active skill */
export function getSkillSystemPromptAddition(): string {
  if (!activeSkill) return '';
  return `\n\n## Active Skill: ${activeSkill.definition.name}\n\n${activeSkill.instructions}`;
}

/** Default instructions when SKILL.md doesn't exist */
function getDefaultInstructions(id: string, config: Record<string, unknown>): string {
  switch (id) {
    case 'linkedin-apply':
      return `You are executing the LinkedIn Auto-Apply skill.

## Goal
Automatically search for and apply to jobs on LinkedIn that match the user's criteria.

## Configuration
- Job Title: ${config.jobTitle || '(not specified)'}
- Location: ${config.location || '(any)'}
- Resume: ${config.resumePath || '(not provided)'}

## Steps
1. Use the browser tool to navigate to LinkedIn (https://www.linkedin.com/jobs/)
2. Search for the specified job title and location
3. Use readDOM to find job listings
4. For each relevant listing:
   a. Click on the job to view details
   b. Read the job description using readDOM
   c. If the job matches well, click "Easy Apply" or "Apply"
   d. Fill in the application form using fillForm/type
   e. Upload resume if required
   f. Submit the application
5. Report back with a summary of applications submitted

## Important
- Only apply to jobs that match the criteria
- Skip jobs that require information you don't have
- Be respectful of rate limits — wait between applications
- Report any jobs that require manual intervention`;

    case 'jira-to-pr': {
      const branchPattern = String(config.branchNaming || '{type}/{ticket}-{name}');
      return `You are executing the Jira-to-PR skill.

## Goal
Read a Jira ticket, understand the requirements, implement the solution, write tests, and create a pull request.

## Configuration
- Ticket ID: ${config.ticketId || '(not specified)'}
- Base Branch: ${config.baseBranch || 'main'}
- Branch Naming Pattern: ${branchPattern}

## Branch Naming Convention
Use this pattern to name the branch: \`${branchPattern}\`

Placeholders:
- \`{type}\` — the type of work based on the ticket: "feature" for new features/stories, "fix" for bugs, "chore" for maintenance tasks, "refactor" for refactoring
- \`{ticket}\` — the Jira ticket ID (e.g., PROJ-123)
- \`{name}\` — a short kebab-case summary derived from the ticket title (e.g., "add-user-auth", "fix-login-redirect")

Examples with pattern "${branchPattern}":
- feature/PROJ-123-add-user-auth
- fix/PROJ-456-login-redirect-loop

## Steps
1. Use the jira tool to read the ticket: getTicket with ticketId="${config.ticketId}"
2. Understand the requirements from the ticket title, description, and acceptance criteria
3. Read any comments for additional context
4. **Check for attachments**: The getTicket response includes an "attachments" array. If there are attachments:
   - Use jira getAttachments to see the full list with file types and sizes
   - Use jira downloadAttachment for each relevant file (specs, JSON configs, images, PDFs, etc.)
   - Text files (JSON, CSV, TXT, MD, etc.) will be returned as readable text
   - Images will be returned as base64 data — analyze them for UI mockups, diagrams, or screenshots
   - PDFs will have text extracted when possible
   - Use attachment content to inform your implementation (e.g., API specs, design mockups, test data)
5. Determine the branch type from the ticket's "type" field:
   - Bug → "fix"
   - Story, Feature, New Feature → "feature"
   - Task, Sub-task → "chore"
   - Improvement → "refactor"
6. Create the branch using the naming pattern above: github createBranch with the computed name and base="${config.baseBranch || 'main'}"
7. Explore the codebase to understand the relevant code (use grep, glob, read_file)
8. Implement the changes based on the ticket requirements and attachment content
9. Write tests for the new functionality
10. Run the tests using bash to ensure they pass
11. If tests fail, fix the issues and re-run
12. Create a PR: github createPR with a title from the ticket, body linking to the Jira ticket, including test results
13. Update the Jira ticket status to "In Review" (or equivalent)
14. Add a comment to the Jira ticket with the PR link

## Important
- Follow existing code patterns and conventions
- Write comprehensive tests
- Don't skip the test step — tests MUST pass before creating the PR
- The PR description should clearly link to the Jira ticket
- Always check and read ticket attachments — they often contain specs, mockups, or test data that are critical to the implementation`;
    }

    default:
      return `Skill "${id}" instructions not found.`;
  }
}
