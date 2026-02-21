import meow from 'meow';
import { APP_NAME, APP_VERSION } from './constants.js';
import type { ProviderType } from '../types/index.js';

export interface CliArgs {
  model: string | undefined;
  url: string | undefined;
  provider: ProviderType | undefined;
  apiKey: string | undefined;
  prompt: string | undefined;
  yolo: boolean;
  continue: boolean;
  session: string | undefined;
}

export function parseArgs(): CliArgs {
  const cli = meow(
    `
  ${APP_NAME} v${APP_VERSION}
  AI coding assistant for the terminal — Ollama, Claude, OpenRouter, DeepSeek

  Usage
    $ orthos [options] [prompt]

  Options
    --provider, -p   LLM provider: ollama, anthropic, openrouter, deepseek (default: ollama)
    --model, -m      Specify the model to use
    --url, -u        Ollama server URL (default: http://localhost:11434)
    --api-key        Set API key/token for the selected provider
    --yolo           Auto-accept all tool executions (no permission prompts)
    --continue, -c   Resume the most recent session
    --session, -s    Resume a specific session by ID
    --help           Show this help
    --version        Show version

  Examples
    $ orthos
    $ orthos --model mistral
    $ orthos --provider anthropic --model claude-sonnet-4-20250514
    $ orthos --provider openrouter --model anthropic/claude-sonnet-4
    $ orthos --yolo "refactor this file"
    $ orthos -c
    $ orthos "explain this error"
`,
    {
      importMeta: import.meta,
      flags: {
        model: { type: 'string', shortFlag: 'm' },
        url: { type: 'string', shortFlag: 'u' },
        provider: { type: 'string', shortFlag: 'p' },
        apiKey: { type: 'string' },
        yolo: { type: 'boolean', default: false },
        continue: { type: 'boolean', shortFlag: 'c', default: false },
        session: { type: 'string', shortFlag: 's' },
      },
    }
  );

  const provider = cli.flags.provider as ProviderType | undefined;

  return {
    model: cli.flags.model,
    url: cli.flags.url,
    provider: provider && ['ollama', 'anthropic', 'openrouter', 'deepseek'].includes(provider) ? provider : undefined,
    apiKey: cli.flags.apiKey,
    prompt: cli.input.length > 0 ? cli.input.join(' ') : undefined,
    yolo: cli.flags.yolo,
    continue: cli.flags.continue,
    session: cli.flags.session,
  };
}
