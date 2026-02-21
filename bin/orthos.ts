#!/usr/bin/env node
import React from 'react';
import { render } from 'ink';
import { parseArgs } from '../src/cli/args.js';
import { getConfig, setConfig } from '../src/cli/config.js';
import { createProvider, getProviderDisplayName } from '../src/core/providers/index.js';
import { App } from '../src/app.js';
import chalk from 'chalk';

// Clear screen and scrollback (hides old terminal output, allows scrollback for app content)
function clearScreen(): void {
  process.stdout.write('\x1B[3J');  // clear scrollback buffer
  process.stdout.write('\x1B[2J');  // clear visible screen
  process.stdout.write('\x1B[H');   // cursor to top-left
}

async function main() {
  const args = parseArgs();
  const config = getConfig();

  // Apply CLI overrides
  if (args.url) {
    config.ollamaUrl = args.url;
    setConfig({ ollamaUrl: args.url });
  }

  if (args.provider) {
    config.provider = args.provider;
    setConfig({ provider: args.provider });
  }

  if (args.apiKey) {
    if (config.provider === 'anthropic') {
      config.anthropicToken = args.apiKey;
      setConfig({ anthropicToken: args.apiKey });
    } else if (config.provider === 'openrouter') {
      config.openrouterApiKey = args.apiKey;
      setConfig({ openrouterApiKey: args.apiKey });
    } else if (config.provider === 'deepseek') {
      config.deepseekApiKey = args.apiKey;
      setConfig({ deepseekApiKey: args.apiKey });
    }
  }

  if (args.yolo) {
    config.yolo = true;
  }

  // Pre-flight: check provider connectivity
  try {
    const provider = createProvider(config);
    const healthy = await provider.checkHealth();

    if (!healthy) {
      const providerName = getProviderDisplayName(config.provider);
      console.error(chalk.red.bold(`\n  Connection Error\n`));
      console.error(chalk.red(`  Cannot connect to ${providerName}\n`));

      if (config.provider === 'ollama') {
        console.error(
          chalk.yellow('  To fix:\n') +
          chalk.white('    1. Install Ollama: ') + chalk.cyan('https://ollama.ai\n') +
          chalk.white('    2. Start the server: ') + chalk.cyan('ollama serve\n') +
          chalk.white('    3. Pull a model: ') + chalk.cyan('ollama pull mistral\n')
        );
      } else if (config.provider === 'anthropic') {
        console.error(
          chalk.yellow('  To fix:\n') +
          chalk.white('    1. Get your token: ') + chalk.cyan('claude setup-token\n') +
          chalk.white('    2. Set it up: ') + chalk.cyan('orthos --provider anthropic --api-key <token>\n') +
          chalk.white('    Or set env: ') + chalk.cyan('CLAUDE_CODE_OAUTH_TOKEN=<token>\n')
        );
      } else if (config.provider === 'openrouter') {
        console.error(
          chalk.yellow('  To fix:\n') +
          chalk.white('    1. Get your API key from: ') + chalk.cyan('https://openrouter.ai/keys\n') +
          chalk.white('    2. Set it up: ') + chalk.cyan('orthos --provider openrouter --api-key <key>\n') +
          chalk.white('    Or set env: ') + chalk.cyan('OPENROUTER_API_KEY=<key>\n')
        );
      } else if (config.provider === 'deepseek') {
        console.error(
          chalk.yellow('  To fix:\n') +
          chalk.white('    1. Get your API key from: ') + chalk.cyan('https://platform.deepseek.com/api_keys\n') +
          chalk.white('    2. Set it up: ') + chalk.cyan('orthos --provider deepseek --api-key <key>\n') +
          chalk.white('    Or set env: ') + chalk.cyan('DEEPSEEK_API_KEY=<key>\n')
        );
      }

      process.exit(1);
    }
  } catch (err) {
    console.error(chalk.red.bold(`\n  Configuration Error\n`));
    console.error(chalk.red(`  ${err instanceof Error ? err.message : 'Unknown error'}\n`));
    process.exit(1);
  }

  // Clear screen for clean start
  clearScreen();

  const { waitUntilExit } = render(
    React.createElement(App, {
      config,
      initialModel: args.model,
      initialPrompt: args.prompt,
      yolo: args.yolo,
      resumeSession: args.continue,
      sessionId: args.session,
    })
  );

  await waitUntilExit();
}

main().catch((err) => {
  console.error(chalk.red('Fatal error:'), err.message || err);
  process.exit(1);
});
