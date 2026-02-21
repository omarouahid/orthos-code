<p align="center">
  <img src="https://img.shields.io/badge/node-%3E%3D18.0.0-brightgreen" alt="Node.js">
  <img src="https://img.shields.io/badge/typescript-5.7-blue" alt="TypeScript">
  <img src="https://img.shields.io/badge/license-MIT-green" alt="License">
  <img src="https://img.shields.io/badge/platform-Windows%20%7C%20macOS%20%7C%20Linux-lightgrey" alt="Platform">
</p>

# Orthos Code

**An AI coding assistant that lives in your terminal.** Write code, manage Jira tickets, create pull requests, control your browser, and run it all from Telegram — powered by Ollama, Anthropic, DeepSeek, or OpenRouter.

Think of it as your own self-hosted Claude Code / Cursor, but open-source, multi-provider, and extensible with a skills system.

---

## What Can It Do?

```
You:  Read the Jira ticket PROJ-42, implement the feature, write tests, and open a PR.
Orthos: Reading ticket... Creating branch feature/PROJ-42-add-user-auth...
        Writing src/auth/middleware.ts... Writing tests...
        Running tests — 14/14 passed.
        PR #87 created: https://github.com/you/repo/pull/87
        Jira ticket moved to "In Review".
```

Orthos is not a chatbot. It's an **agent** — it reads your files, writes code, runs commands, browses the web, manages your project board, and ships code. From your terminal or from your phone.

---

## Features

### Core
- **Interactive terminal UI** — Rich REPL with streaming responses, syntax highlighting, and markdown rendering
- **File operations** — Read, write, edit files. Attach files with `@filename` syntax
- **Shell execution** — Run any command via the `bash` tool
- **Search** — Grep across codebases, glob for files, web search for documentation
- **Git** — Status, diff, log, commit — all as native tools the AI can use
- **Auto-compact** — Automatically summarizes old messages when the context window fills up
- **Session persistence** — Conversations are saved and restored between sessions

### Multi-Provider Support
| Provider | Models | Setup |
|----------|--------|-------|
| **Ollama** (default) | Mistral, Llama, CodeLlama, Qwen, etc. | `ollama serve` + `ollama pull <model>` |
| **Anthropic** | Claude 3.5 Sonnet, Claude 3 Opus | `orthos --provider anthropic --api-key <key>` |
| **DeepSeek** | DeepSeek Coder, DeepSeek Chat | `orthos --provider deepseek --api-key <key>` |
| **OpenRouter** | Any model on OpenRouter | `orthos --provider openrouter --api-key <key>` |

### Browser Control
Control **your own Chrome** — not Playwright, not a headless browser. Your actual browser with your cookies, sessions, and logins.

```
/browser start          # Start WebSocket server
# Load the Chrome extension (see below)
/browser status         # Verify connection

You: Go to github.com/notifications and summarize my unread notifications
Orthos: Navigating... Reading DOM... You have 3 unread notifications: [...]
```

**Actions:** `navigate`, `click`, `type`, `screenshot`, `readDOM`, `fillForm`, `getTabs`, `executeJS`, `waitForSelector`, `scrollTo`, `getPageInfo`

### Telegram Bot
Run Orthos from your phone. Full AI coding assistant — not just a chat relay. The same tool loop, the same capabilities, just through Telegram.

```
/telegram start         # Start the bot (or auto-starts on launch)
```

Then open your Telegram bot and send any message — code questions, file edits, git operations, browser actions — everything works.

### Jira Integration
Read tickets, check attachments (PDFs, images, JSON), update statuses, add comments.

```
/setup jira https://yourcompany.atlassian.net you@email.com YOUR_API_TOKEN
```

### GitHub Integration
Create branches, open PRs, list PRs, add comments. Uses the `gh` CLI under the hood.

```
/setup github YOUR_GITHUB_TOKEN    # or just have `gh` CLI authenticated
```

### Skills System
Extensible workflows that combine multiple tools into autonomous pipelines.

| Skill | What it does |
|-------|-------------|
| **jira-to-pr** | Reads a Jira ticket → creates a branch → implements the code → writes tests → runs tests → opens a PR → updates Jira |
| **linkedin-apply** | Searches LinkedIn for jobs → auto-applies using the browser extension |

```bash
/skill jira-to-pr --ticketId=PROJ-123                                    # Use defaults
/skill jira-to-pr --ticketId=PROJ-123 --branchNaming=fix/{ticket}-{name} # Custom branch naming
/skill linkedin-apply --jobTitle="Software Engineer" --location="Remote"
```

### Admin Mode
Bypass all permission prompts. Auto-approves everything including plans.

```
/admin          # Toggle admin mode (also enables YOLO)
```

### Agent Mode (Orchestrator)
For complex multi-step tasks, Orthos can plan and delegate to specialized sub-agents:

```
/agent          # Toggle orchestrator mode
```

The orchestrator creates a plan, then delegates steps to **coder**, **researcher**, and **reviewer** agents that work with their own tool sets.

---

## Quick Start

### Prerequisites
- **Node.js 18+** — [Download](https://nodejs.org/)
- **Ollama** — [Download](https://ollama.ai/) (or use Anthropic/DeepSeek/OpenRouter instead)

### Install

```bash
git clone https://github.com/YOUR_USERNAME/orthos-code.git
cd orthos-code
npm install
npm run build

# Make the command available globally
npm link
```

### Run

```bash
# With Ollama (default)
ollama serve                    # Start Ollama in another terminal
ollama pull mistral             # Pull a model
orthos                          # Launch Orthos

# With Anthropic
orthos --provider anthropic --api-key sk-ant-...

# With DeepSeek
orthos --provider deepseek --api-key sk-...

# Development mode (no rebuild needed)
orthos2                         # Runs from TypeScript source via tsx
npm run dev                     # Same thing
```

### CLI Flags

```bash
orthos                              # Interactive session
orthos --model mistral              # Start with specific model
orthos "explain this error"         # Start with an initial prompt
orthos -u http://host:11434         # Custom Ollama URL
orthos --provider anthropic         # Use Anthropic provider
orthos --api-key <key>              # Set API key for current provider
orthos --yolo                       # Skip permission prompts
orthos --continue                   # Resume last session
orthos --session <id>               # Resume specific session
```

---

## Telegram Bot Setup

This is the full guide to run Orthos from your phone.

### 1. Create Your Bot

1. Open Telegram, search for **@BotFather**
2. Send `/newbot`, follow the prompts
3. Copy the bot token (looks like `1234567890:ABCdef...`)

### 2. Configure

```bash
# In Orthos terminal:
/setup telegram YOUR_BOT_TOKEN

# Or set it before launching:
# The token is saved in your config after first setup
```

### 3. Start the Bot

```bash
# Option A: Auto-start (if previously configured)
# The bot starts automatically when you launch Orthos

# Option B: Manual start
/telegram start
```

### 4. Use It

Open your bot in Telegram and send any message:

```
You: Read src/app.tsx and explain the main component
Bot: [reads the file, gives detailed explanation]

You: Add error handling to the login function in src/auth.ts
Bot: [reads the file, edits it, shows the diff]

You: Run the tests
Bot: [executes npm test, shows results]

You: Take a screenshot of localhost:3000
Bot: [captures screenshot via browser extension, sends as photo]
```

**Telegram commands:**
| Command | Description |
|---------|-------------|
| `/start` | Welcome message |
| `/status` | Show current model, provider, cwd, browser status |
| `/clear` | Clear conversation history |
| `/model <name>` | Switch model |
| `/provider <name>` | Switch provider |
| `/screenshot` | Take a browser screenshot |

### 5. Security

- Only users in the `allowedUsers` list can interact with the bot
- Add allowed users: `/telegram allow <telegram_user_id>`
- The bot runs with full tool access (equivalent to admin mode)
- Conversation history is per-chat with 1-hour idle timeout

---

## Browser Extension Setup

### 1. Start the WebSocket Server

```bash
# In Orthos terminal:
/browser start
```

This starts a WebSocket server on `ws://127.0.0.1:18900`.

### 2. Load the Extension in Chrome

1. Open Chrome → `chrome://extensions/`
2. Enable **Developer mode** (top right toggle)
3. Click **Load unpacked**
4. Select the `extension/` folder from this project
5. The Orthos extension icon appears in your toolbar

### 3. Connect

1. Click the Orthos extension icon
2. Enter the auth token shown by `/browser start`
3. Click **Connect**
4. The status bar in Orthos shows a green browser indicator

### 4. Use It

```
You: Navigate to https://github.com and read the page
You: Click on the "Sign in" button
You: Fill the login form with email "me@example.com" and password "..."
You: Take a screenshot
You: Run document.querySelectorAll('a').length on the page
```

The extension controls your **real Chrome** — with your cookies, sessions, and logins. No Playwright, no headless browser, no detection.

---

## All Slash Commands

| Command | Description |
|---------|-------------|
| `/help` | Show all commands |
| `/model [name]` | Switch AI model |
| `/models` | List available models |
| `/provider [name]` | Switch provider (ollama/anthropic/deepseek/openrouter) |
| `/clear` | Clear conversation |
| `/compact` | Manually summarize old messages |
| `/tokens` | Show token usage |
| `/yolo` | Toggle auto-approve for tools |
| `/admin` | Toggle admin mode (unrestricted) |
| `/agent` | Toggle orchestrator mode |
| `/browser` | Start/stop/status browser connection |
| `/telegram` | Start/stop/status/allow Telegram bot |
| `/setup jira <url> <email> <token>` | Configure Jira |
| `/setup github <token>` | Configure GitHub |
| `/skill <id> [--params]` | Run a skill |
| `/session` | List saved sessions |
| `/session <id>` | Load a session |
| `/config` | Show current configuration |
| `/permissions` | Manage tool permissions |
| `/exit` | Exit Orthos |

---

## Tools (What the AI Can Use)

| Tool | Category | Description |
|------|----------|-------------|
| `read_file` | File | Read file contents |
| `write_file` | File | Create or overwrite files |
| `edit_file` | File | Search-and-replace edits |
| `bash` | Execute | Run shell commands |
| `grep` | Search | Regex search across files |
| `glob` | Search | Find files by pattern |
| `git_status` | Git | Show working tree status |
| `git_diff` | Git | Show file diffs |
| `git_commit` | Git | Create commits |
| `git_log` | Git | View commit history |
| `web_search` | Search | Search the web |
| `browser` | Execute | Control Chrome (11 actions) |
| `jira` | Execute | Manage Jira tickets (7 actions) |
| `github` | Execute | Manage GitHub PRs (5 actions) |
| `create_plan` | Planning | Create multi-step plans |
| `update_plan_step` | Planning | Update plan step status |
| `delegate_to_agent` | Agent | Delegate to specialized sub-agents |

---

## Project Structure

```
orthos-code/
├── bin/
│   ├── orthos.ts                    # CLI entry point
│   └── orthos2-runner.js            # Dev runner (tsx)
├── extension/                       # Chrome extension (Manifest V3)
│   ├── manifest.json
│   ├── background.js                # WebSocket client + Chrome APIs
│   ├── content.js                   # Content script
│   ├── popup.html / popup.js        # Extension popup UI
│   └── icons/
├── src/
│   ├── app.tsx                      # Root Ink app (React for CLI)
│   ├── cli/
│   │   ├── args.ts                  # CLI argument parsing
│   │   ├── config.ts                # Persistent config (XDG-compliant)
│   │   └── constants.ts             # System prompts, defaults
│   ├── components/
│   │   ├── prompt-input.tsx         # User input with @file support
│   │   ├── message-list.tsx         # Conversation display
│   │   ├── message.tsx              # Single message rendering
│   │   ├── markdown-renderer.ts     # Terminal markdown
│   │   ├── status-bar.tsx           # Model, tokens, indicators
│   │   ├── welcome.tsx              # Welcome screen
│   │   ├── model-picker.tsx         # Interactive model picker
│   │   ├── plan-viewer.tsx          # Plan approval UI
│   │   └── slash-command-menu.tsx   # Command autocomplete
│   ├── core/
│   │   ├── tools/                   # All 17 tool implementations
│   │   │   ├── index.ts             # Tool registry
│   │   │   ├── bash.ts, read-file.ts, write-file.ts, edit-file.ts
│   │   │   ├── grep.ts, glob.ts, git.ts, web-search.ts
│   │   │   ├── browser.ts, jira.ts, github-pr.ts
│   │   │   └── types.ts
│   │   ├── browser/                 # Chrome extension bridge
│   │   │   ├── server.ts            # WebSocket server
│   │   │   ├── client.ts            # High-level browser API
│   │   │   └── types.ts
│   │   ├── telegram/                # Telegram bot
│   │   │   ├── bot.ts               # grammY bot wrapper
│   │   │   ├── handler.ts           # Message → LLM → tool loop
│   │   │   └── types.ts
│   │   ├── integrations/
│   │   │   ├── jira-client.ts       # Jira REST API v3 client
│   │   │   └── github-client.ts     # GitHub CLI wrapper
│   │   ├── providers/               # LLM provider abstraction
│   │   │   ├── ollama.ts, anthropic.ts, deepseek.ts, openrouter.ts
│   │   │   ├── index.ts             # Provider factory
│   │   │   └── types.ts
│   │   ├── orchestrator/            # Agent mode
│   │   │   ├── orchestrator.ts      # Multi-agent delegation
│   │   │   └── agent-tools.ts       # Per-role tool filtering
│   │   ├── skills/                  # Skills engine
│   │   │   ├── loader.ts            # Load/activate skills
│   │   │   └── types.ts
│   │   ├── permissions.ts           # Permission system + admin mode
│   │   ├── planner.ts               # Plan creation/management
│   │   ├── slash-commands.ts        # 20 slash commands
│   │   └── ...
│   ├── skills/                      # Skill definitions
│   │   ├── jira-to-pr/
│   │   │   ├── skill.json           # Metadata + config schema
│   │   │   └── SKILL.md             # AI instructions
│   │   └── linkedin-apply/
│   │       ├── skill.json
│   │       └── SKILL.md
│   └── types/
│       └── index.ts                 # Shared TypeScript interfaces
├── package.json
├── tsconfig.json
├── tsup.config.ts
└── .gitignore
```

---

## Environment Variables

| Variable | Description |
|----------|-------------|
| `ANTHROPIC_API_KEY` | Anthropic API key |
| `OPENROUTER_API_KEY` | OpenRouter API key |
| `DEEPSEEK_API_KEY` | DeepSeek API key |
| `JIRA_API_TOKEN` | Jira API token (alternative to `/setup jira`) |
| `GITHUB_TOKEN` | GitHub token (alternative to `gh` CLI auth) |

---

## Troubleshooting

### "Cannot connect to Ollama"
```bash
ollama serve          # Make sure Ollama is running
ollama list           # Check installed models
```

### "No models found"
```bash
ollama pull mistral   # Pull a model first
```

### Browser extension won't connect
1. Check that `/browser start` is running (look for the green indicator in status bar)
2. Verify the auth token in the extension popup matches the one shown in the terminal
3. Make sure no firewall is blocking `localhost:18900`

### Telegram bot not responding
1. Check `/telegram status` — should show "running"
2. Make sure your Telegram user ID is in the allowed list: `/telegram allow <your_id>`
3. Check that the bot token is valid: `/setup telegram <token>`

### Slow responses
- Try a smaller model (`mistral`, `phi`, `qwen2.5-coder`)
- Ensure you have enough RAM (8GB+ for most models)
- Use `/compact` to reduce context size
- Switch to a cloud provider for faster inference

---

## Tech Stack

| Technology | Purpose |
|------------|---------|
| [Ink](https://github.com/vadimdemedes/ink) | React for interactive CLIs |
| [grammY](https://grammy.dev/) | Telegram Bot framework |
| [ws](https://github.com/websockets/ws) | WebSocket server for browser extension |
| [Marked](https://github.com/markedjs/marked) | Markdown rendering |
| [cli-highlight](https://github.com/isagalaev/highlight.js) | Syntax highlighting |
| [gpt-tokenizer](https://github.com/niieani/gpt-tokenizer) | Token counting |
| [Conf](https://github.com/sindresorhus/conf) | Persistent configuration |

---

## License

MIT
