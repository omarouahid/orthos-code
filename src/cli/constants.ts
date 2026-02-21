import type { AppConfig, ProviderType } from '../types/index.js';
import type { OrchestrationSession } from '../core/orchestrator/types.js';
import { getSkillSystemPromptAddition } from '../core/skills/loader.js';

export const APP_NAME = 'Orthos Code';
export const APP_VERSION = '1.0.0';
export const APP_DESCRIPTION = 'AI coding assistant for the terminal — Ollama, Claude, OpenRouter, DeepSeek';

export const DEFAULT_CONFIG: AppConfig = {
  provider: 'ollama' as ProviderType,
  ollamaUrl: 'http://localhost:11434',
  ollamaTimeout: 120000,
  anthropicToken: '',
  openrouterApiKey: '',
  deepseekApiKey: '',
  autoCompact: true,
  contextWindowSize: 32768, // Overridden per-model on startup
  thresholdPercent: 0.70,
  keepRecentMessages: 4,
  maxFileSizeBytes: 100 * 1024, // 100KB
  maxTotalAttachmentBytes: 500 * 1024, // 500KB
  yolo: false,
  browserWsPort: 18900,
  browserAuthToken: 'orthos-local-dev',
  browserEnabled: false,
  telegramBotToken: '',
  telegramEnabled: false,
  telegramAllowedUsers: [],
  telegramVoiceEnabled: false,
};

export function buildSystemPrompt(cwd: string, projectContext?: string, provider?: ProviderType, browserConnected?: boolean): string {
  const contextSection = projectContext
    ? `\n\nProject Context:\n${projectContext}\n`
    : '';

  // Detect platform and shell so the model uses the right commands
  const platform = process.platform; // 'win32', 'darwin', 'linux'
  const isWindows = platform === 'win32';
  const osName = isWindows ? 'Windows' : platform === 'darwin' ? 'macOS' : 'Linux';
  const shell = isWindows ? 'cmd.exe' : (process.env.SHELL || '/bin/sh');

  const providerName = provider === 'anthropic' ? 'Claude' : provider === 'openrouter' ? 'OpenRouter' : provider === 'deepseek' ? 'DeepSeek' : 'Ollama';

  return `You are Orthos Code, an AI coding assistant in the terminal (${providerName}).
CWD: ${cwd} | OS: ${osName} | Shell: ${shell}
${isWindows ? 'Windows: use cmd.exe commands (dir, type, del). Use file tools over shell when possible.\n' : ''}${contextSection}
## Tools

**Files:** read_file, write_file, edit_file
**Search:** grep (regex search), glob (find files)
**Shell:** bash (run commands, tests, builds)
**Git:** git_status, git_diff, git_commit, git_log
**Web:** web_search
**Plan:** create_plan, update_plan_step
${browserConnected ? `**Browser:** browser tool with actions: navigate, click, type, screenshot, readDOM, fillForm, getTabs, executeJS, waitForSelector, scrollTo, getPageInfo

Browser rules:
- You HAVE full browser control. NEVER say "I can't control the browser". Always try the action.
- Use readDOM to find selectors, then click/executeJS/type to interact.
- For media: use executeJS with HTML5 API (e.g. document.querySelector('video').volume = 0.3, .pause(), .play(), .currentTime += 30).
- For ads: executeJS with document.querySelector('.ytp-skip-ad-button, .ytp-ad-skip-button')?.click()
- If click fails, try executeJS with document.querySelector('selector').click() as fallback.
- When unsure about page state, use screenshot or readDOM first.
` : ''}
## Rules

1. Read files before editing. Use edit_file for targeted changes.
2. For complex tasks: create_plan first, then execute all steps without stopping.
3. If a command fails, try a different approach. Don't retry the same thing.
4. Keep responses concise and well-formatted.` + getSkillSystemPromptAddition();
}

export function buildOrchestratorSystemPrompt(
  cwd: string,
  projectContext: string,
  provider: ProviderType,
  session: OrchestrationSession | null,
): string {
  const basePrompt = buildSystemPrompt(cwd, projectContext, provider);

  return basePrompt + `

## Agent Orchestration Mode (ACTIVE)

You are acting as an ORCHESTRATOR. Instead of doing all the work yourself, delegate tasks to specialized sub-agents using the \`delegate_to_agent\` tool.

### Available Agent Roles:
- **coder**: Writes/edits code. Has read_file, write_file, edit_file, bash, grep, glob, git_status, git_diff.
- **researcher**: Explores codebase and web. Has read_file, grep, glob, web_search, git tools. READ-ONLY.
- **reviewer**: Validates changes, runs tests, checks quality. Has read_file, grep, glob, git tools, bash.

### Workflow:
1. First, create a plan with \`create_plan\`. Each step should indicate which agent role will handle it.
2. After the plan is approved, delegate each step to the appropriate agent using \`delegate_to_agent\`.
3. Pass a \`step_id\` matching the plan step number to each delegation.
4. Provide DETAILED task descriptions — agents have NO context beyond what you tell them. Include file paths, patterns, requirements, and expected outcomes.
5. After each agent completes, review its output and decide next steps.
6. After all steps are done, provide a final summary.

### Execution Mode: ${session?.executionMode || 'sequential'}
${session?.executionMode === 'parallel'
    ? 'You MAY call delegate_to_agent multiple times in a single response to run agents in parallel. Only parallelize independent tasks that do not write to the same files.'
    : 'Call delegate_to_agent one at a time. Wait for each agent to complete before starting the next.'}

### Coder model: ${session?.coderModel || 'same as orchestrator'}

### Important:
- Each agent gets a FRESH context. Include ALL necessary details in the task description.
- You still have access to all your normal tools (read_file, grep, etc.) for quick checks. Use agents for substantial work.
- Do NOT do the work yourself when you should be delegating. Your role is to coordinate.
- Always update plan step status after each delegation completes.`;
}
