import chalk from 'chalk';
import type { Message, AppConfig } from '../types/index.js';
import type { LLMProvider } from './providers/types.js';
import { createProvider, getProviderDisplayName } from './providers/index.js';
import { countMessageTokens } from './token-counter.js';
import { compactMessages } from './auto-compact.js';
import { clearMessages, newConversation } from './message-store.js';
import { isYoloMode, setYoloMode, getPermissions, isAdminMode, setAdminMode } from './permissions.js';
import { listSessions, resumeSession } from './session-manager.js';
import { getCurrentPlan, getPlanProgress } from './planner.js';
import { setConfig, getConfig } from '../cli/config.js';
import { setJiraConfig } from './tools/jira.js';
import { listSkills, loadSkill, getActiveSkill, deactivateSkill } from './skills/loader.js';

export interface CommandContext {
  messages: Message[];
  model: string;
  config: AppConfig;
  cwd: string;
  provider: LLMProvider;
  setMessages: (msgs: Message[]) => void;
  setModel: (model: string) => void;
  setProvider: (provider: LLMProvider) => void;
  exit: () => void;
}

export interface CommandResult {
  output: string;
  action?: 'clear' | 'exit' | 'model-pick' | 'session-pick' | 'view-diff' | 'agent-mode-on' | 'agent-mode-off' | 'browser-start' | 'browser-stop' | 'telegram-start' | 'telegram-stop';
  messageId?: string;
}

interface SlashCommand {
  name: string;
  aliases: string[];
  description: string;
  execute: (args: string, ctx: CommandContext) => Promise<CommandResult>;
}

const commands: SlashCommand[] = [
  {
    name: 'help',
    aliases: ['h', '?'],
    description: 'Show available commands',
    execute: async () => ({
      output: formatHelp(),
    }),
  },
  {
    name: 'clear',
    aliases: ['c'],
    description: 'Clear conversation and start fresh',
    execute: async (_, ctx) => {
      clearMessages();
      ctx.setMessages([]);
      newConversation();
      return { output: chalk.green('Conversation cleared.'), action: 'clear' as const };
    },
  },
  {
    name: 'provider',
    aliases: ['p'],
    description: 'Switch LLM provider (ollama/anthropic/openrouter/deepseek)',
    execute: async (args, ctx) => {
      const providerName = args.trim().toLowerCase();
      if (!providerName) {
        const current = ctx.config.provider;
        const lines = [
          chalk.cyan.bold('  LLM Providers'),
          '',
          `  ${current === 'ollama' ? chalk.green('> ') : '  '}${chalk.bold('ollama')}       ${chalk.dim('Local models via Ollama')}${current === 'ollama' ? chalk.green(' (active)') : ''}`,
          `  ${current === 'anthropic' ? chalk.green('> ') : '  '}${chalk.bold('anthropic')}   ${chalk.dim('Claude models via Anthropic API')}${current === 'anthropic' ? chalk.green(' (active)') : ''}`,
          `  ${current === 'openrouter' ? chalk.green('> ') : '  '}${chalk.bold('openrouter')} ${chalk.dim('Many models via OpenRouter')}${current === 'openrouter' ? chalk.green(' (active)') : ''}`,
          `  ${current === 'deepseek' ? chalk.green('> ') : '  '}${chalk.bold('deepseek')}    ${chalk.dim('DeepSeek V3/R1 via DeepSeek API')}${current === 'deepseek' ? chalk.green(' (active)') : ''}`,
          '',
          chalk.dim('  Switch: /provider <name>'),
          chalk.dim('  Setup keys: /setup <provider>'),
        ];
        return { output: lines.join('\n') };
      }

      if (!['ollama', 'anthropic', 'openrouter', 'deepseek'].includes(providerName)) {
        return {
          output: chalk.red(`Unknown provider: ${providerName}\n`) +
            chalk.dim('Available: ollama, anthropic, openrouter, deepseek'),
        };
      }

      const newProviderType = providerName as 'ollama' | 'anthropic' | 'openrouter' | 'deepseek';
      ctx.config.provider = newProviderType;
      setConfig({ provider: newProviderType });

      try {
        const newProvider = createProvider(ctx.config);
        ctx.setProvider(newProvider);

        // Load models for the new provider
        const models = await newProvider.getAvailableModels();
        let ctxInfo = '';
        if (models.length > 0) {
          ctx.setModel(models[0].name);
          // Update context window size from the new model
          const ctxLen = models[0].contextLength
            || await newProvider.getModelContextLength(models[0].name);
          if (ctxLen > 0) {
            ctx.config.contextWindowSize = ctxLen;
            ctxInfo = chalk.dim(` (${Math.round(ctxLen / 1000)}K context)`);
          }
        }

        return {
          output: chalk.green(`Switched to ${chalk.bold(getProviderDisplayName(newProviderType))}`) +
            (models.length > 0 ? chalk.dim(`\n  Model: ${models[0].name}`) + ctxInfo : ''),
        };
      } catch (err) {
        return {
          output: chalk.red(`Failed to switch to ${providerName}: ${err instanceof Error ? err.message : 'unknown error'}\n`) +
            chalk.dim('Run /setup ' + providerName + ' to configure credentials.'),
        };
      }
    },
  },
  {
    name: 'setup',
    aliases: [],
    description: 'Setup API keys for providers',
    execute: async (args, ctx) => {
      const providerName = args.trim().toLowerCase();

      if (!providerName) {
        // Show status of all providers
        const config = getConfig();
        const hasAnthropic = !!(config.anthropicToken || process.env.CLAUDE_CODE_OAUTH_TOKEN);
        const hasOpenRouter = !!(config.openrouterApiKey || process.env.OPENROUTER_API_KEY);
        const hasDeepSeek = !!(config.deepseekApiKey || process.env.DEEPSEEK_API_KEY);

        const lines = [
          chalk.cyan.bold('  Provider Setup Status'),
          '',
          `  ${chalk.bold('Ollama')}       ${chalk.green('ready')} ${chalk.dim('(no key needed)')}`,
          `  ${chalk.bold('Anthropic')}   ${hasAnthropic ? chalk.green('configured') : chalk.yellow('not configured')}`,
          `  ${chalk.bold('OpenRouter')} ${hasOpenRouter ? chalk.green('configured') : chalk.yellow('not configured')}`,
          `  ${chalk.bold('DeepSeek')}    ${hasDeepSeek ? chalk.green('configured') : chalk.yellow('not configured')}`,
          '',
          chalk.dim('  To configure: /setup <provider>'),
          chalk.dim('  Example: /setup anthropic'),
        ];
        return { output: lines.join('\n') };
      }

      if (providerName === 'anthropic') {
        return {
          output: chalk.cyan.bold('  Setup Anthropic (Claude)\n\n') +
            chalk.white('  1. Run ') + chalk.cyan('claude setup-token') + chalk.white(' in your terminal\n') +
            chalk.white('  2. Copy the token (starts with ') + chalk.cyan('sk-ant-oat01-') + chalk.white(')\n') +
            chalk.white('  3. Paste it here as: ') + chalk.cyan('/setup anthropic <your-token>\n\n') +
            chalk.dim('  Or set the env var: CLAUDE_CODE_OAUTH_TOKEN=<token>'),
        };
      }

      if (providerName === 'openrouter') {
        return {
          output: chalk.cyan.bold('  Setup OpenRouter\n\n') +
            chalk.white('  1. Get your API key from ') + chalk.cyan('https://openrouter.ai/keys\n') +
            chalk.white('  2. Paste it here as: ') + chalk.cyan('/setup openrouter <your-key>\n\n') +
            chalk.dim('  Or set the env var: OPENROUTER_API_KEY=<key>'),
        };
      }

      if (providerName === 'deepseek') {
        return {
          output: chalk.cyan.bold('  Setup DeepSeek\n\n') +
            chalk.white('  1. Get your API key from ') + chalk.cyan('https://platform.deepseek.com/api_keys\n') +
            chalk.white('  2. Paste it here as: ') + chalk.cyan('/setup deepseek <your-key>\n\n') +
            chalk.dim('  Or set the env var: DEEPSEEK_API_KEY=<key>'),
        };
      }

      // Handle token/key input: /setup anthropic sk-ant-oat01-...
      if (providerName.startsWith('anthropic ')) {
        const token = providerName.slice('anthropic '.length).trim();
        if (token) {
          setConfig({ anthropicToken: token });
          ctx.config.anthropicToken = token;
          return { output: chalk.green('Anthropic token saved successfully!') };
        }
      }

      if (providerName.startsWith('openrouter ')) {
        const key = providerName.slice('openrouter '.length).trim();
        if (key) {
          setConfig({ openrouterApiKey: key });
          ctx.config.openrouterApiKey = key;
          return { output: chalk.green('OpenRouter API key saved successfully!') };
        }
      }

      if (providerName.startsWith('deepseek ')) {
        const key = providerName.slice('deepseek '.length).trim();
        if (key) {
          setConfig({ deepseekApiKey: key });
          ctx.config.deepseekApiKey = key;
          return { output: chalk.green('DeepSeek API key saved successfully!') };
        }
      }

      // Handle /setup jira <url> <email> <token>
      if (providerName === 'jira') {
        return {
          output: chalk.cyan.bold('  Setup Jira\n\n') +
            chalk.white('  Usage: ') + chalk.cyan('/setup jira <base_url> <email> <api_token>\n') +
            chalk.white('  Example: ') + chalk.cyan('/setup jira https://company.atlassian.net user@company.com ATATT...'),
        };
      }

      if (providerName.startsWith('jira ')) {
        const parts = providerName.slice('jira '.length).trim().split(/\s+/);
        if (parts.length >= 3) {
          const [url, email, ...tokenParts] = parts;
          const token = tokenParts.join(' ');
          setJiraConfig({ baseUrl: url, email, apiToken: token });
          return { output: chalk.green('Jira configured successfully!') };
        }
        return { output: chalk.red('Usage: /setup jira <base_url> <email> <api_token>') };
      }

      return {
        output: chalk.red(`Unknown provider: ${providerName}\n`) +
          chalk.dim('Available: anthropic, openrouter, deepseek, jira'),
      };
    },
  },
  {
    name: 'model',
    aliases: ['m'],
    description: 'Switch model (e.g., /model mistral)',
    execute: async (args, ctx) => {
      if (!args.trim()) {
        return { output: '', action: 'model-pick' as const };
      }
      const models = await ctx.provider.getAvailableModels();
      const match = models.find(
        (m) => m.name === args.trim() || m.name.startsWith(args.trim())
      );
      if (match) {
        ctx.setModel(match.name);
        // Update context window size
        const ctxLen = match.contextLength
          || await ctx.provider.getModelContextLength(match.name);
        if (ctxLen > 0) ctx.config.contextWindowSize = ctxLen;
        return {
          output: chalk.green(`Switched to model: ${chalk.bold(match.name)}`) +
            (ctxLen > 0 ? chalk.dim(` (${Math.round(ctxLen / 1000)}K context)`) : ''),
        };
      }
      return {
        output: chalk.red(`Model "${args.trim()}" not found.\n`) +
          chalk.dim(`Available: ${models.slice(0, 10).map((m) => m.name).join(', ')}${models.length > 10 ? ` (+${models.length - 10} more)` : ''}`),
      };
    },
  },
  {
    name: 'models',
    aliases: [],
    description: 'List all available models for current provider',
    execute: async (_, ctx) => {
      const models = await ctx.provider.getAvailableModels();
      const providerName = getProviderDisplayName(ctx.config.provider);

      if (models.length === 0) {
        if (ctx.config.provider === 'ollama') {
          return { output: chalk.yellow('No models found. Pull one with: ollama pull mistral') };
        }
        return { output: chalk.yellow(`No models available from ${providerName}.`) };
      }

      const list = models
        .slice(0, 30) // Limit display
        .map((m) => {
          const active = m.name === ctx.model ? chalk.green(' (active)') : '';
          const extra = m.size ? chalk.dim(` ${formatBytes(m.size)}`) :
            m.displayName && m.displayName !== m.name ? chalk.dim(` ${m.displayName}`) : '';
          return `  ${chalk.bold(m.name)}${extra}${active}`;
        })
        .join('\n');

      const more = models.length > 30 ? chalk.dim(`\n  ... and ${models.length - 30} more`) : '';
      return { output: chalk.cyan(`${providerName} models:\n`) + list + more };
    },
  },
  {
    name: 'compact',
    aliases: [],
    description: 'Manually compact/summarize the conversation (preserves active plan)',
    execute: async (_, ctx) => {
      if (ctx.messages.length <= 4) {
        return { output: chalk.dim('Conversation is too short to compact.') };
      }
      const plan = getCurrentPlan();
      const result = await compactMessages(ctx.messages, ctx.model, ctx.config, ctx.provider, plan ?? undefined);
      if (result) {
        ctx.setMessages(result.messages);
        return { output: chalk.green('Conversation compacted successfully. Active plan (if any) is preserved so you can continue.') };
      }
      return { output: chalk.dim('Conversation is already compact.') };
    },
  },
  {
    name: 'tokens',
    aliases: ['t'],
    description: 'Show current token usage',
    execute: async (_, ctx) => {
      const count = countMessageTokens(ctx.messages);
      const limit = ctx.config.contextWindowSize;
      const pct = Math.round((count / limit) * 100);
      const bar = renderBar(pct);
      return {
        output:
          chalk.cyan(`Token usage: ~${count} / ${limit} tokens (${pct}%)\n`) +
          bar,
      };
    },
  },
  {
    name: 'yolo',
    aliases: [],
    description: 'Toggle YOLO mode (auto-accept all tool executions)',
    execute: async () => {
      const current = isYoloMode();
      setYoloMode(!current);
      if (!current) {
        return {
          output:
            chalk.yellow.bold('YOLO MODE: ON') + '\n' +
            chalk.yellow('  All tool executions will be auto-accepted.') + '\n' +
            chalk.dim('  Use /yolo again to disable.'),
        };
      }
      return {
        output:
          chalk.green.bold('YOLO MODE: OFF') + '\n' +
          chalk.dim('  Tool executions will require approval when needed.'),
      };
    },
  },
  {
    name: 'admin',
    aliases: [],
    description: 'Toggle Admin mode (all permissions auto-approved, no prompts)',
    execute: async () => {
      const current = isAdminMode();
      setAdminMode(!current);
      if (!current) {
        setYoloMode(true);
        return {
          output:
            chalk.red.bold('ADMIN MODE: ON') + '\n' +
            chalk.red('  All permissions auto-approved. No prompts. Plans auto-approved.') + '\n' +
            chalk.dim('  YOLO mode also enabled.') + '\n' +
            chalk.dim('  Use /admin again to disable.'),
        };
      }
      return {
        output:
          chalk.green.bold('ADMIN MODE: OFF') + '\n' +
          chalk.dim('  Returning to normal permission flow.'),
      };
    },
  },
  {
    name: 'permissions',
    aliases: ['perms'],
    description: 'Show current permission settings',
    execute: async () => {
      const perms = getPermissions();
      const yolo = isYoloMode();
      const lines = [
        chalk.cyan.bold('  Permission Settings'),
        '',
        `  ${chalk.bold('YOLO mode:')}  ${yolo ? chalk.yellow.bold('ON') : chalk.green('OFF')}`,
        '',
        `  ${chalk.bold('Read files:')}   ${formatPermLevel(perms.read)}`,
        `  ${chalk.bold('Write files:')}  ${formatPermLevel(perms.write)}`,
        `  ${chalk.bold('Execute:')}      ${formatPermLevel(perms.execute)}`,
        `  ${chalk.bold('Search:')}       ${formatPermLevel(perms.search)}`,
        `  ${chalk.bold('Git:')}          ${formatPermLevel(perms.git)}`,
        '',
        chalk.dim('  Toggle YOLO: /yolo'),
      ];
      return { output: lines.join('\n') };
    },
  },
  {
    name: 'sessions',
    aliases: [],
    description: 'List saved sessions',
    execute: async () => {
      const sessions = listSessions();
      if (sessions.length === 0) {
        return { output: chalk.dim('No saved sessions.') };
      }
      return { output: '', action: 'session-pick' as const };
    },
  },
  {
    name: 'resume',
    aliases: [],
    description: 'Resume a saved session by ID',
    execute: async (args, ctx) => {
      if (!args.trim()) {
        const sessions = listSessions();
        if (sessions.length === 0) {
          return { output: chalk.dim('No sessions to resume.') };
        }
        return { output: '', action: 'session-pick' as const };
      }

      const sessions = listSessions();
      const index = parseInt(args.trim(), 10);
      let session;
      if (!isNaN(index) && index >= 1 && index <= sessions.length) {
        session = resumeSession(sessions[index - 1].id);
      } else {
        session = resumeSession(args.trim());
      }

      if (session) {
        ctx.setMessages(session.messages);
        return { output: chalk.green(`Resumed: ${session.name}`) };
      }
      return { output: chalk.red(`Session "${args.trim()}" not found.`) };
    },
  },
  {
    name: 'plan',
    aliases: [],
    description: 'Show current plan status',
    execute: async () => {
      const plan = getCurrentPlan();
      if (!plan) {
        return { output: chalk.dim('No active plan. The AI creates plans automatically for complex tasks.') };
      }

      const progress = getPlanProgress();
      const lines = [
        chalk.cyan.bold(`  ${plan.title}`),
        '',
      ];

      for (const step of plan.steps) {
        const icon = step.status === 'completed' ? chalk.green('v')
          : step.status === 'in_progress' ? chalk.yellow('*')
          : step.status === 'failed' ? chalk.red('x')
          : chalk.dim('o');
        const color = step.status === 'completed' ? chalk.green
          : step.status === 'in_progress' ? chalk.yellow
          : step.status === 'failed' ? chalk.red
          : chalk.dim;
        const duration = step.duration ? chalk.dim(` (${step.duration < 1000 ? step.duration + 'ms' : (step.duration / 1000).toFixed(1) + 's'})`) : '';
        lines.push(`  ${icon} ${color(`${step.id}. ${step.title}`)}${duration}`);
      }

      lines.push('');
      lines.push(chalk.dim(`  Progress: ${progress.completed}/${progress.total}`) +
        (plan.approved ? chalk.green(' (approved)') : chalk.yellow(' (pending)')));

      return { output: lines.join('\n') };
    },
  },
  {
    name: 'diff',
    aliases: ['inspect', 'd'],
    description: 'Inspect full file changes from the last edit',
    execute: async (_, ctx) => {
      for (let i = ctx.messages.length - 1; i >= 0; i--) {
        const msg = ctx.messages[i];
        if (msg.role !== 'assistant' || !msg.toolResults?.length) continue;
        const hasDiff = msg.toolResults.some((r) => r.diff);
        if (hasDiff) {
          return {
            output: chalk.dim('Opening diff viewer...'),
            action: 'view-diff' as const,
            messageId: msg.id,
          };
        }
      }
      return { output: chalk.dim('No file changes in this conversation to inspect.') };
    },
  },
  {
    name: 'agent',
    aliases: ['agents', 'orchestrate'],
    description: 'Toggle agent mode (orchestrator + specialized agents)',
    execute: async (args) => {
      const mode = args.trim().toLowerCase();
      if (mode === 'off' || mode === 'stop') {
        return {
          output: chalk.green('Agent mode deactivated. Next task will use single-agent mode.'),
          action: 'agent-mode-off' as const,
        };
      }
      return {
        output: chalk.magenta.bold('Agent mode activated') + '\n' +
          chalk.dim('The next task will use specialized agents (Coder, Researcher, Reviewer).') + '\n' +
          chalk.dim('You\'ll be asked to choose execution mode and coder model.') + '\n' +
          chalk.dim('Use /agent off to deactivate.'),
        action: 'agent-mode-on' as const,
      };
    },
  },
  {
    name: 'telegram',
    aliases: ['tg'],
    description: 'Control Telegram bot (start/stop/status)',
    execute: async (args, ctx) => {
      const subcommand = args.trim().toLowerCase();
      if (subcommand === 'stop') {
        return {
          output: chalk.yellow('Stopping Telegram bot...'),
          action: 'telegram-stop' as const,
        };
      }
      if (subcommand === 'status') {
        const isEnabled = ctx.config.telegramEnabled;
        const hasToken = !!ctx.config.telegramBotToken;
        const allowed = ctx.config.telegramAllowedUsers;
        const lines = [
          chalk.cyan.bold('  Telegram Bot Status'),
          '',
          `  ${chalk.bold('Bot:')}      ${isEnabled ? chalk.green('running') : chalk.yellow('stopped')}`,
          `  ${chalk.bold('Token:')}    ${hasToken ? chalk.green('configured') : chalk.yellow('not set')}`,
          `  ${chalk.bold('Allowed:')} ${allowed.length > 0 ? chalk.white(allowed.join(', ')) : chalk.dim('(all users)')}`,
          `  ${chalk.bold('Voice:')}   ${ctx.config.telegramVoiceEnabled ? chalk.green('enabled') : chalk.dim('disabled')}`,
          '',
          chalk.dim('  /telegram start — start the bot'),
          chalk.dim('  /telegram stop  — stop the bot'),
          chalk.dim('  /telegram allow <user_id> — add allowed user'),
        ];
        return { output: lines.join('\n') };
      }
      if (subcommand.startsWith('allow ')) {
        const userId = parseInt(subcommand.slice('allow '.length).trim(), 10);
        if (isNaN(userId)) {
          return { output: chalk.red('Invalid user ID. Usage: /telegram allow 123456789') };
        }
        if (!ctx.config.telegramAllowedUsers.includes(userId)) {
          ctx.config.telegramAllowedUsers.push(userId);
        }
        return { output: chalk.green(`Added Telegram user ${userId} to allowed list.`) };
      }
      if (subcommand.startsWith('token ')) {
        const token = subcommand.slice('token '.length).trim();
        if (token) {
          ctx.config.telegramBotToken = token;
          setConfig({ telegramBotToken: token });
          return { output: chalk.green('Telegram bot token saved.') };
        }
      }
      // Default: start
      if (!ctx.config.telegramBotToken) {
        return { output: chalk.red('No Telegram bot token configured. Use: /telegram token <bot_token>') };
      }
      return {
        output: chalk.green('Starting Telegram bot...'),
        action: 'telegram-start' as const,
      };
    },
  },
  {
    name: 'browser',
    aliases: [],
    description: 'Control browser extension server (start/stop/status)',
    execute: async (args, ctx) => {
      const subcommand = args.trim().toLowerCase();
      if (subcommand === 'stop') {
        return {
          output: chalk.yellow('Stopping browser server...'),
          action: 'browser-stop' as const,
        };
      }
      if (subcommand === 'status') {
        const isEnabled = ctx.config.browserEnabled;
        const token = ctx.config.browserAuthToken;
        const port = ctx.config.browserWsPort || 18900;
        const lines = [
          chalk.cyan.bold('  Browser Extension Status'),
          '',
          `  ${chalk.bold('Server:')}  ${isEnabled ? chalk.green('running') : chalk.yellow('stopped')}`,
          `  ${chalk.bold('Port:')}    ${chalk.white(String(port))}`,
          `  ${chalk.bold('Token:')}   ${token ? chalk.green(token.slice(0, 8) + '...') : chalk.dim('(none)')}`,
          '',
          chalk.dim('  /browser start — start the WS server'),
          chalk.dim('  /browser stop  — stop the WS server'),
        ];
        return { output: lines.join('\n') };
      }
      // Default: start
      return {
        output: chalk.green('Starting browser server...'),
        action: 'browser-start' as const,
      };
    },
  },
  {
    name: 'skill',
    aliases: [],
    description: 'Manage skills (list/activate/deactivate)',
    execute: async (args) => {
      const subcommand = args.trim().toLowerCase();

      // /skill off | /skill deactivate
      if (subcommand === 'off' || subcommand === 'deactivate' || subcommand === 'stop') {
        const active = getActiveSkill();
        if (!active) {
          return { output: chalk.dim('No skill is currently active.') };
        }
        deactivateSkill();
        return { output: chalk.green(`Skill "${active.definition.name}" deactivated.`) };
      }

      // /skill list or /skill (no args)
      if (!subcommand || subcommand === 'list') {
        const skills = listSkills();
        const active = getActiveSkill();
        const lines = [
          chalk.cyan.bold('  Available Skills'),
          '',
        ];
        for (const s of skills) {
          const isActive = active?.definition.id === s.id;
          lines.push(
            `  ${isActive ? chalk.green('> ') : '  '}${chalk.bold(s.id)} — ${chalk.white(s.name)}`,
          );
          lines.push(`    ${chalk.dim(s.description)}`);
          lines.push(`    ${chalk.dim('Requires:')} ${chalk.cyan(s.requiredTools.join(', '))}`);
          if (s.configSchema) {
            const params = Object.entries(s.configSchema)
              .map(([k, v]) => `${k}${v.required ? '' : '?'}`)
              .join(', ');
            lines.push(`    ${chalk.dim('Params:')} ${chalk.cyan(params)}`);
          }
          lines.push('');
        }
        lines.push(chalk.dim('  Activate: /skill <id> --param=value'));
        lines.push(chalk.dim('  Example:  /skill jira-to-pr --ticketId=PROJ-123'));
        lines.push(chalk.dim('  Deactivate: /skill off'));
        return { output: lines.join('\n') };
      }

      // /skill status
      if (subcommand === 'status') {
        const active = getActiveSkill();
        if (!active) {
          return { output: chalk.dim('No skill is currently active.') };
        }
        const lines = [
          chalk.cyan.bold(`  Active Skill: ${active.definition.name}`),
          '',
          `  ${chalk.bold('ID:')}     ${active.definition.id}`,
          `  ${chalk.bold('Config:')} ${JSON.stringify(active.config)}`,
          '',
          chalk.dim('  /skill off — deactivate'),
        ];
        return { output: lines.join('\n') };
      }

      // /skill <id> --key=value --key2=value2
      // Parse skill ID and config from args
      const parts = args.trim().split(/\s+/);
      const skillId = parts[0].toLowerCase();
      const config: Record<string, unknown> = {};

      for (let i = 1; i < parts.length; i++) {
        const part = parts[i];
        const match = part.match(/^--(\w+)=(.+)$/);
        if (match) {
          config[match[1]] = match[2];
        }
      }

      const instance = loadSkill(skillId, config);
      if (!instance) {
        return {
          output: chalk.red(`Unknown skill: ${skillId}\n`) +
            chalk.dim('Use /skill list to see available skills.'),
        };
      }

      // Validate required config
      const schema = instance.definition.configSchema;
      if (schema) {
        for (const [key, def] of Object.entries(schema)) {
          if (def.required && !config[key]) {
            deactivateSkill();
            return {
              output: chalk.red(`Missing required parameter: --${key}\n`) +
                chalk.dim(`Description: ${def.description}`),
            };
          }
        }
      }

      return {
        output: chalk.green.bold(`Skill activated: ${instance.definition.name}`) + '\n' +
          chalk.dim(`Config: ${JSON.stringify(config)}`) + '\n' +
          chalk.dim('The AI now has skill-specific instructions. Send your next message to begin.') + '\n' +
          chalk.dim('Use /skill off to deactivate.'),
      };
    },
  },
  {
    name: 'exit',
    aliases: ['quit', 'q'],
    description: 'Exit Orthos Code',
    execute: async () => ({
      output: chalk.dim('Goodbye!'),
      action: 'exit' as const,
    }),
  },
];

export function isSlashCommand(input: string): boolean {
  return input.startsWith('/');
}

export async function executeCommand(
  input: string,
  ctx: CommandContext
): Promise<CommandResult> {
  const parts = input.slice(1).split(/\s+/);
  const name = parts[0].toLowerCase();
  const args = parts.slice(1).join(' ');

  // Handle /setup with token: the token is part of "args" but the setup command
  // also accepts the full provider+token as args, so we pass all remaining text
  const cmd = commands.find(
    (c) => c.name === name || c.aliases.includes(name)
  );

  if (!cmd) {
    return {
      output: chalk.red(`Unknown command: /${name}\n`) +
        chalk.dim('Type /help for available commands.'),
    };
  }

  return cmd.execute(args, ctx);
}

function formatPermLevel(level: string): string {
  switch (level) {
    case 'allow': return chalk.green('allow');
    case 'ask': return chalk.yellow('ask');
    case 'deny': return chalk.red('deny');
    default: return chalk.dim(level);
  }
}

function formatHelp(): string {
  const divider = chalk.blue.dim('-'.repeat(50));

  const lines = [
    '',
    chalk.bold.cyan('  Orthos Code -- Command Reference'),
    `  ${divider}`,
    '',
    chalk.bold.yellow('  COMMANDS'),
    '',
    `  ${chalk.green.bold('/help')}  ${chalk.dim('(/h, /?)')}`,
    `    ${chalk.white('Display this help guide with all commands explained.')}`,
    '',
    `  ${chalk.green.bold('/provider')}  ${chalk.dim('(/p)')}  ${chalk.dim('[name]')}`,
    `    ${chalk.white('Switch LLM provider: ollama, anthropic, openrouter, deepseek.')}`,
    `    ${chalk.dim('Without args: shows available providers.')}`,
    `    ${chalk.dim('With args: switches directly, e.g.')} ${chalk.cyan('/provider anthropic')}`,
    '',
    `  ${chalk.green.bold('/setup')}  ${chalk.dim('[provider]')}`,
    `    ${chalk.white('Configure API keys for providers.')}`,
    `    ${chalk.dim('Without args: shows configuration status.')}`,
    `    ${chalk.dim('With provider: guides through setup.')}`,
    `    ${chalk.dim('With token:')} ${chalk.cyan('/setup anthropic <token>')}`,
    '',
    `  ${chalk.green.bold('/model')}  ${chalk.dim('(/m)')}  ${chalk.dim('[name]')}`,
    `    ${chalk.white('Switch the active model.')}`,
    `    ${chalk.dim('Without args: opens an interactive model picker.')}`,
    `    ${chalk.dim('With args: switches directly, e.g.')} ${chalk.cyan('/model mistral')}`,
    '',
    `  ${chalk.green.bold('/models')}`,
    `    ${chalk.white('List all available models for current provider.')}`,
    `    ${chalk.dim('Shows which model is currently active.')}`,
    '',
    `  ${chalk.green.bold('/clear')}  ${chalk.dim('(/c)')}`,
    `    ${chalk.white('Clear the entire conversation and start fresh.')}`,
    `    ${chalk.dim('Removes all messages from memory and disk.')}`,
    '',
    `  ${chalk.green.bold('/compact')}`,
    `    ${chalk.white('Manually summarize older messages to save context.')}`,
    `    ${chalk.dim('Keeps the last 4 messages, summarizes the rest.')}`,
    `    ${chalk.dim('Happens automatically when context window fills up.')}`,
    '',
    `  ${chalk.green.bold('/tokens')}  ${chalk.dim('(/t)')}`,
    `    ${chalk.white('Show current conversation token count and usage bar.')}`,
    `    ${chalk.dim('Helps you see how much context window is being used.')}`,
    '',
    `  ${chalk.green.bold('/yolo')}`,
    `    ${chalk.white('Toggle YOLO mode: auto-accept all tool executions.')}`,
    `    ${chalk.dim('When ON, file edits, bash commands, etc. run without asking.')}`,
    '',
    `  ${chalk.green.bold('/admin')}`,
    `    ${chalk.white('Toggle Admin mode: all permissions auto-approved, no prompts.')}`,
    `    ${chalk.dim('Stronger than YOLO: auto-approves plans, agent mode, everything.')}`,
    '',
    `  ${chalk.green.bold('/permissions')}  ${chalk.dim('(/perms)')}`,
    `    ${chalk.white('Show current permission settings for each tool category.')}`,
    '',
    `  ${chalk.green.bold('/sessions')}`,
    `    ${chalk.white('List all saved conversation sessions.')}`,
    `    ${chalk.dim('Shows session name, message count, and last update time.')}`,
    '',
    `  ${chalk.green.bold('/resume')}  ${chalk.dim('[id or number]')}`,
    `    ${chalk.white('Resume a saved session.')}`,
    `    ${chalk.dim('Without args: resumes the most recent session.')}`,
    `    ${chalk.dim('With number: resumes by list position from /sessions.')}`,
    '',
    `  ${chalk.green.bold('/plan')}`,
    `    ${chalk.white('Show current plan status and progress.')}`,
    `    ${chalk.dim('Plans are created automatically by the AI for complex tasks.')}`,
    '',
    `  ${chalk.green.bold('/diff')}  ${chalk.dim('(/inspect, /d)')}`,
    `    ${chalk.white('Inspect full file changes from the most recent edit.')}`,
    `    ${chalk.dim('Opens a viewer with the complete diff. Press Esc to close.')}`,
    '',
    `  ${chalk.green.bold('/agent')}  ${chalk.dim('(/agents, /orchestrate)')}`,
    `    ${chalk.white('Toggle agent mode: orchestrator + specialized agents.')}`,
    `    ${chalk.dim('Activates: Coder, Researcher, Reviewer agents for complex tasks.')}`,
    `    ${chalk.dim('/agent off — deactivate agent mode.')}`,
    '',
    `  ${chalk.green.bold('/telegram')}  ${chalk.dim('(/tg)')}  ${chalk.dim('[start|stop|status|allow|token]')}`,
    `    ${chalk.white('Control the Telegram bot for remote Orthos access.')}`,
    `    ${chalk.dim('/telegram — start the Telegram bot.')}`,
    `    ${chalk.dim('/telegram stop — stop the bot.')}`,
    `    ${chalk.dim('/telegram status — show bot status.')}`,
    `    ${chalk.dim('/telegram allow <user_id> — restrict access to a user.')}`,
    '',
    `  ${chalk.green.bold('/browser')}  ${chalk.dim('[start|stop|status]')}`,
    `    ${chalk.white('Control the browser extension WebSocket server.')}`,
    `    ${chalk.dim('/browser — start the server and show auth token.')}`,
    `    ${chalk.dim('/browser stop — stop the server.')}`,
    `    ${chalk.dim('/browser status — show connection status.')}`,
    '',
    `  ${chalk.green.bold('/skill')}  ${chalk.dim('[id|list|status|off]')}`,
    `    ${chalk.white('Manage skills — extensible AI workflows.')}`,
    `    ${chalk.dim('/skill — list available skills.')}`,
    `    ${chalk.dim('/skill <id> --param=value — activate a skill.')}`,
    `    ${chalk.dim('/skill off — deactivate current skill.')}`,
    `    ${chalk.dim('Example: /skill jira-to-pr --ticketId=PROJ-123')}`,
    '',
    `  ${chalk.green.bold('/exit')}  ${chalk.dim('(/quit, /q)')}`,
    `    ${chalk.white('Exit Orthos Code. Conversation is auto-saved.')}`,
    '',
    `  ${divider}`,
    '',
    chalk.bold.yellow('  TOOLS (used by the AI automatically)'),
    '',
    `    ${chalk.cyan('read_file')}    ${chalk.dim('Read file contents')}`,
    `    ${chalk.cyan('write_file')}   ${chalk.dim('Create or overwrite files')}`,
    `    ${chalk.cyan('edit_file')}    ${chalk.dim('Targeted search-and-replace edits')}`,
    `    ${chalk.cyan('bash')}         ${chalk.dim('Execute shell commands')}`,
    `    ${chalk.cyan('grep')}         ${chalk.dim('Search file contents with regex')}`,
    `    ${chalk.cyan('glob')}         ${chalk.dim('Find files by pattern')}`,
    `    ${chalk.cyan('git_status')}   ${chalk.dim('Check git repository status')}`,
    `    ${chalk.cyan('git_diff')}     ${chalk.dim('View staged/unstaged changes')}`,
    `    ${chalk.cyan('git_commit')}   ${chalk.dim('Stage and commit changes')}`,
    `    ${chalk.cyan('git_log')}      ${chalk.dim('View commit history')}`,
    `    ${chalk.cyan('web_search')}   ${chalk.dim('Search the web for docs, errors, APIs')}`,
    `    ${chalk.cyan('browser')}      ${chalk.dim('Control Chrome via extension (navigate, click, type, screenshot...)')}`,
    `    ${chalk.cyan('jira')}         ${chalk.dim('Read/update Jira tickets, comments, attachments')}`,
    `    ${chalk.cyan('github')}       ${chalk.dim('Create branches, PRs, comments via gh CLI')}`,
    `    ${chalk.cyan('create_plan')}  ${chalk.dim('Create a step-by-step plan (auto for complex tasks)')}`,
    '',
    `  ${divider}`,
    '',
    chalk.bold.yellow('  FILE ATTACHMENTS'),
    '',
    `    ${chalk.white('Use')} ${chalk.cyan('@filename')} ${chalk.white('to include file contents in your message.')}`,
    `    ${chalk.dim('The file is read from your current directory.')}`,
    '',
    `    ${chalk.dim('Examples:')}`,
    `      ${chalk.cyan('@src/app.tsx')} ${chalk.dim('explain this file')}`,
    `      ${chalk.dim('fix the bug in')} ${chalk.cyan('@utils/parser.ts')}`,
    `      ${chalk.dim('compare')} ${chalk.cyan('@old.js')} ${chalk.dim('and')} ${chalk.cyan('@new.js')}`,
    '',
    `    ${chalk.dim('Limits: 100KB per file, 500KB total, text files only.')}`,
    '',
    `  ${divider}`,
    '',
    chalk.bold.yellow('  KEYBOARD SHORTCUTS'),
    '',
    `    ${chalk.bold('Enter')}        ${chalk.dim('Send your message')}`,
    `    ${chalk.bold('Ctrl+C')}       ${chalk.dim('Cancel streaming response / Exit')}`,
    `    ${chalk.bold('Up/Down')}      ${chalk.dim('Navigate model picker')}`,
    `    ${chalk.bold('Y/N')}          ${chalk.dim('Approve/deny tool permissions')}`,
    '',
    `  ${divider}`,
    '',
    chalk.bold.yellow('  CLI FLAGS'),
    '',
    `    ${chalk.cyan('--provider, -p')} ${chalk.dim('LLM provider:')} ${chalk.white('orthos -p anthropic')}`,
    `    ${chalk.cyan('--model, -m')}    ${chalk.dim('Set model on startup:')} ${chalk.white('orthos -m mistral')}`,
    `    ${chalk.cyan('--url, -u')}      ${chalk.dim('Custom Ollama URL:')} ${chalk.white('orthos -u http://host:11434')}`,
    `    ${chalk.cyan('--api-key')}      ${chalk.dim('Set API key/token for provider')}`,
    `    ${chalk.cyan('--yolo')}         ${chalk.dim('Start with YOLO mode (auto-accept tools)')}`,
    `    ${chalk.cyan('--continue, -c')} ${chalk.dim('Resume most recent session')}`,
    `    ${chalk.cyan('--session, -s')}  ${chalk.dim('Resume specific session by ID')}`,
    `    ${chalk.cyan('--help')}         ${chalk.dim('Show help and exit')}`,
    `    ${chalk.cyan('--version')}      ${chalk.dim('Show version and exit')}`,
    '',
  ];
  return lines.join('\n');
}

function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return Math.round((bytes / Math.pow(k, i)) * 100) / 100 + ' ' + sizes[i];
}

function renderBar(percent: number): string {
  const width = 30;
  const filled = Math.round((percent / 100) * width);
  const empty = width - filled;
  const color = percent > 80 ? chalk.red : percent > 50 ? chalk.yellow : chalk.green;
  return `  ${color('#'.repeat(filled))}${chalk.dim('.'.repeat(empty))} ${percent}%`;
}
