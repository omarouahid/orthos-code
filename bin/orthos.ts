#!/usr/bin/env node
import React from 'react';
import { render } from 'ink';
import { parseArgs } from '../src/cli/args.js';
import { getConfigForCwd, setConfig } from '../src/cli/config.js';
import { checkProviderPreflight } from '../src/cli/preflight.js';
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
  const cwd = process.cwd();
  const config = getConfigForCwd(cwd);

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

  // Pre-flight: check provider connectivity (non-blocking — app lets user switch/configure)
  const preflight = await checkProviderPreflight(config);

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
      initialProviderUnhealthy: preflight.initialProviderUnhealthy,
    })
  );

  await waitUntilExit();
}

main().catch((err) => {
  console.error(chalk.red('Fatal error:'), err.message || err);
  process.exit(1);
});
