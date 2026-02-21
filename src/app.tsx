import React, { useState, useCallback, useEffect, useRef, useMemo } from 'react';
import { Box, Text, useInput } from 'ink';
import type { Message, AppConfig, Plan, ModelInfo } from './types/index.js';
import type { ToolResult } from './core/tools/types.js';
import type { LLMProvider } from './core/providers/types.js';
import { Welcome } from './components/welcome.js';
import { MessageList } from './components/message-list.js';
import { PromptInput } from './components/prompt-input.js';
import { StatusBar } from './components/status-bar.js';
import { ModelPicker } from './components/model-picker.js';
import { PermissionPrompt } from './components/permission-prompt.js';
import { PlanDisplay } from './components/plan-display.js';
import { TaskTracker } from './components/task-tracker.js';
import { BottomBar } from './components/bottom-bar.js';
import { SlashCommandMenu } from './components/slash-command-menu.js';
import { SessionPicker } from './components/session-picker.js';
import { DiffViewer } from './components/diff-viewer.js';
import { createProvider } from './core/providers/index.js';
import { resolveFileReferences, buildFileContext } from './core/file-reader.js';
import { isSlashCommand, executeCommand } from './core/slash-commands.js';
import { shouldCompact, compactMessages } from './core/auto-compact.js';
import { countMessageTokens } from './core/token-counter.js';
import { loadMessages, persistMessages, clearMessages as clearStore, newConversation, flushPendingSave } from './core/message-store.js';
import { setSelectedModel, getSelectedModel } from './cli/config.js';
import { buildSystemPrompt } from './cli/constants.js';
import { loadProjectContext, ensureProjectContext } from './core/project-context.js';
import { ALL_TOOLS, getActiveTools, executeTool, formatToolCall } from './core/tools/index.js';
import { checkPermission, setYoloMode, isYoloMode, isAdminMode } from './core/permissions.js';
import { saveSession, getCurrentSession, listSessions, resumeSession as resumeSessionById } from './core/session-manager.js';
import { getCurrentPlan, clearPlan, planEvents, updateStepStatus } from './core/planner.js';
import { copyToClipboard } from './utils/clipboard.js';
import {
  analyzeComplexity,
  executeDelegation,
  executeParallelDelegations,
  startOrchestrationSession,
  getOrchestrationSession,
  clearOrchestrationSession,
} from './core/orchestrator/index.js';
import type { AgentRole, ExecutionMode, OrchestrationSession } from './core/orchestrator/types.js';
import { AgentModePrompt } from './components/agent-mode-prompt.js';
import { AgentTracker } from './components/agent-tracker.js';
import { buildOrchestratorSystemPrompt } from './cli/constants.js';
import { BrowserServer } from './core/browser/server.js';
import { BrowserClient } from './core/browser/client.js';
import { executeBrowser } from './core/tools/browser.js';
import { executeJira } from './core/tools/jira.js';
import { randomUUID } from 'crypto';
import { TelegramBot } from './core/telegram/bot.js';
import { TelegramHandler } from './core/telegram/handler.js';

// Commands safe to run while AI is streaming (read-only, no state mutation)
const SAFE_STREAMING_COMMANDS = new Set([
  'help', 'h', '?', 'tokens', 't', 'plan',
  'permissions', 'perms', 'models', 'yolo', 'admin',
  'exit', 'quit', 'q', 'agent', 'agents', 'browser', 'telegram', 'tg',
]);

interface AppProps {
  config: AppConfig;
  initialModel?: string;
  initialPrompt?: string;
  yolo?: boolean;
  resumeSession?: boolean;
  sessionId?: string;
}

export function App({ config, initialModel, initialPrompt, yolo, resumeSession, sessionId }: AppProps) {
  const [messages, setMessages] = useState<Message[]>([]);
  const [model, setModel] = useState(initialModel || getSelectedModel() || '');
  const [models, setModels] = useState<ModelInfo[]>([]);
  const [isStreaming, setIsStreaming] = useState(false);
  const providerRef = useRef<LLMProvider>(createProvider(config));
  const [streamingContent, setStreamingContent] = useState('');
  const [streamingThinking, setStreamingThinking] = useState('');
  const [showModelPicker, setShowModelPicker] = useState(false);
  const [showCommandMenu, setShowCommandMenu] = useState(false);
  const [showSessionPicker, setShowSessionPicker] = useState(false);
  const [commandOutput, setCommandOutput] = useState('');
  const [error, setError] = useState('');
  const [animationDone, setAnimationDone] = useState(false);
  const [inputKey, setInputKey] = useState(0);
  const [activeToolName, setActiveToolName] = useState<string | undefined>();
  const [selectedMessageId, setSelectedMessageId] = useState<string | null>(null);
  const [pendingPermission, setPendingPermission] = useState<{
    toolName: string;
    toolArgs: Record<string, unknown>;
    resolve: (approved: boolean, note?: string) => void;
  } | null>(null);
  const [currentPlan, setCurrentPlan] = useState<Plan | null>(null);
  const [pendingPlanApproval, setPendingPlanApproval] = useState<{
    plan: Plan;
    resolve: (approved: boolean, specification?: string) => void;
  } | null>(null);
  const [queueCount, setQueueCount] = useState(0);
  const [viewingDiffMessageId, setViewingDiffMessageId] = useState<string | null>(null);
  // Orchestrator / agent mode state
  const [agentModeActive, setAgentModeActive] = useState(false);
  const [orchestrationSession, setOrchestrationSession] = useState<OrchestrationSession | null>(null);
  const [pendingAgentMode, setPendingAgentMode] = useState<{
    reason: string;
    resolve: (config: { executionMode: ExecutionMode; coderModel: string } | null) => void;
  } | null>(null);
  // Browser extension state
  const browserServerRef = useRef<BrowserServer | null>(null);
  const browserClientRef = useRef<BrowserClient | null>(null);
  const [browserConnected, setBrowserConnected] = useState(false);

  // Telegram bot state
  const telegramBotRef = useRef<TelegramBot | null>(null);
  const telegramHandlerRef = useRef<TelegramHandler | null>(null);
  const [telegramRunning, setTelegramRunning] = useState(false);

  const abortRef = useRef<AbortController | null>(null);
  const queueRef = useRef<string[]>([]);
  const wasStreamingRef = useRef(false);
  const msgIdCounter = useRef(0);
  const nextMsgId = useCallback(() => `msg-${Date.now()}-${++msgIdCounter.current}`, []);
  const cwd = process.cwd();
  const projectContext = useRef<string>('');

  // Browser server start/stop helpers
  const startBrowserServer = useCallback(async () => {
    if (browserServerRef.current) {
      setCommandOutput('\x1b[33mBrowser server already running.\x1b[0m');
      return;
    }
    const token = config.browserAuthToken || randomUUID().replace(/-/g, '').slice(0, 24);
    const port = config.browserWsPort || 18900;
    config.browserAuthToken = token;
    config.browserEnabled = true;

    const server = new BrowserServer(port, token);
    server.on('connected', () => {
      setBrowserConnected(true);
      setCommandOutput('\x1b[32mBrowser extension connected!\x1b[0m');
    });
    server.on('disconnected', () => {
      setBrowserConnected(false);
      setCommandOutput('\x1b[33mBrowser extension disconnected.\x1b[0m');
    });

    try {
      await server.start();
      browserServerRef.current = server;
      browserClientRef.current = new BrowserClient(server);
      setCommandOutput(
        `\x1b[32mBrowser server started on ws://127.0.0.1:${port}\x1b[0m\n` +
        `\x1b[36mAuth token: \x1b[1m${token}\x1b[0m\n` +
        `\x1b[90mPaste this token in the Chrome extension popup and click Connect.\x1b[0m`
      );
    } catch (err) {
      setCommandOutput(`\x1b[31mFailed to start browser server: ${err instanceof Error ? err.message : 'unknown error'}\x1b[0m`);
    }
  }, [config]);

  const stopBrowserServer = useCallback(() => {
    if (browserServerRef.current) {
      browserServerRef.current.stop();
      browserServerRef.current = null;
      browserClientRef.current = null;
      setBrowserConnected(false);
      config.browserEnabled = false;
      setCommandOutput('\x1b[32mBrowser server stopped.\x1b[0m');
    } else {
      setCommandOutput('\x1b[33mBrowser server is not running.\x1b[0m');
    }
  }, [config]);

  // Telegram bot start/stop helpers
  const startTelegramBot = useCallback(async () => {
    if (telegramBotRef.current) {
      setCommandOutput('\x1b[33mTelegram bot is already running.\x1b[0m');
      return;
    }
    if (!config.telegramBotToken) {
      setCommandOutput('\x1b[31mNo Telegram bot token. Use /telegram token <token>\x1b[0m');
      return;
    }

    const handler = new TelegramHandler({
      provider: providerRef.current,
      config,
      model,
      cwd,
      projectContext: projectContext.current,
    });
    if (browserClientRef.current) {
      handler.setBrowserClient(browserClientRef.current);
    }
    telegramHandlerRef.current = handler;

    const bot = new TelegramBot(
      {
        botToken: config.telegramBotToken,
        enabled: true,
        allowedUserIds: config.telegramAllowedUsers || [],
        voiceEnabled: config.telegramVoiceEnabled || false,
      },
      handler,
    );

    try {
      await bot.start();
      telegramBotRef.current = bot;
      setTelegramRunning(true);
      config.telegramEnabled = true;
      setCommandOutput('\x1b[32mTelegram bot started! Send messages to your bot.\x1b[0m');
    } catch (err) {
      setCommandOutput(`\x1b[31mFailed to start Telegram bot: ${err instanceof Error ? err.message : 'unknown error'}\x1b[0m`);
    }
  }, [config, model, cwd]);

  const stopTelegramBot = useCallback(async () => {
    if (telegramBotRef.current) {
      await telegramBotRef.current.stop();
      telegramBotRef.current = null;
      telegramHandlerRef.current = null;
      setTelegramRunning(false);
      config.telegramEnabled = false;
      setCommandOutput('\x1b[32mTelegram bot stopped.\x1b[0m');
    } else {
      setCommandOutput('\x1b[33mTelegram bot is not running.\x1b[0m');
    }
  }, [config]);

  // Sync plan state from planner module to React state
  const syncPlan = useCallback(() => {
    const plan = getCurrentPlan();
    if (plan) {
      setCurrentPlan({ ...plan, steps: plan.steps.map((s) => ({ ...s })) });
    }
  }, []);

  // Listen for plan updates via Node.js EventEmitter
  useEffect(() => {
    const handlePlanUpdate = () => {
      syncPlan();
    };

    planEvents.on('planStepUpdated', handlePlanUpdate);

    return () => {
      planEvents.off('planStepUpdated', handlePlanUpdate);
    };
  }, [syncPlan]);

  // Enable YOLO mode if flag passed
  useEffect(() => {
    if (yolo || config.yolo) {
      setYoloMode(true);
    }
  }, [yolo, config.yolo]);

  // SIGINT (Ctrl+C): stop streaming if in progress, otherwise exit
  // Handles terminals that send SIGINT instead of key events
  useEffect(() => {
    const onSigint = () => {
      if (abortRef.current) {
        abortRef.current.abort();
      } else {
        process.exit(0);
      }
    };
    process.on('SIGINT', onSigint);
    return () => {
      process.off('SIGINT', onSigint);
    };
  }, []);

  // Load models, project context, and saved conversation on mount
  useEffect(() => {
    (async () => {
      // Ensure ORTHOS.md exists in the project
      ensureProjectContext(cwd);

      projectContext.current = loadProjectContext(cwd);

      try {
        const provider = providerRef.current;
        const available = await provider.getAvailableModels();
        setModels(available);

        // Determine which model to use
        let activeModel = model;
        if (!activeModel && available.length > 0) {
          // Check if any model has contextLength from the provider listing
          activeModel = available[0].name;
          setModel(activeModel);
          setSelectedModel(activeModel);
        }

        // Always fetch context length for the active model
        if (activeModel) {
          // First check if the model list already has context info
          const modelInfo = available.find((m) => m.name === activeModel);
          if (modelInfo?.contextLength && modelInfo.contextLength > 0) {
            config.contextWindowSize = modelInfo.contextLength;
          } else {
            const ctxLen = await provider.getModelContextLength(activeModel);
            config.contextWindowSize = ctxLen;
          }
        }
      } catch (err) {
        setError(`Failed to load models: ${err instanceof Error ? err.message : 'connection error'}`);
      }

      // Only load previous conversations when explicitly requested
      if (sessionId) {
        const session = resumeSessionById(sessionId);
        if (session) {
          setMessages(session.messages);
          setAnimationDone(true);
          return;
        }
      }
      if (resumeSession) {
        const sessions = listSessions();
        if (sessions.length > 0) {
          const latest = resumeSessionById(sessions[0].id);
          if (latest) {
            setMessages(latest.messages);
            setAnimationDone(true);
            return;
          }
        }
      }

      // Start fresh — don't auto-load old messages
      // Use --continue (-c) or /resume to load previous sessions
      clearStore();
    })();
  }, []);

  // Auto-start Telegram bot if configured
  useEffect(() => {
    if (config.telegramBotToken && config.telegramEnabled && model) {
      startTelegramBot();
    }
  }, [model]); // Run once model is resolved

  // Keep Telegram handler in sync with current model/provider/browser
  useEffect(() => {
    if (telegramHandlerRef.current) {
      telegramHandlerRef.current.setModel(model);
      telegramHandlerRef.current.setProvider(providerRef.current);
      telegramHandlerRef.current.setBrowserClient(browserClientRef.current);
    }
  }, [model, browserConnected]);

  // Handle initial prompt (from CLI args)
  useEffect(() => {
    if (initialPrompt && animationDone && model) {
      handleUserInput(initialPrompt);
    }
  }, [animationDone, model]);

  // Tool-use loop with plan support
  const runToolLoop = useCallback(async (
    currentMessages: Message[],
    currentModel: string,
    abort: AbortController,
  ): Promise<{ finalMessages: Message[]; finalContent: string }> => {
    let loopMessages = [...currentMessages];
    let finalContent = '';
    // High safety limit to prevent infinite loops — but the real exit condition is plan completion
    const MAX_SAFETY_ITERATIONS = 200;
    let iteration = 0;

    while (iteration < MAX_SAFETY_ITERATIONS) {
      iteration++;
      setStreamingContent('');
      setStreamingThinking('');

      const provider = providerRef.current;
      const isBrowserUp = browserClientRef.current?.isConnected ?? false;
      const activeTools = getActiveTools(agentModeActive, isBrowserUp);
      const systemPrompt = agentModeActive
        ? buildOrchestratorSystemPrompt(cwd, projectContext.current, config.provider, orchestrationSession)
        : buildSystemPrompt(cwd, projectContext.current, config.provider, isBrowserUp);

      const result = await provider.streamChat(
        currentModel,
        loopMessages,
        systemPrompt,
        (chunk) => {
          setStreamingContent((prev) => prev + chunk);
        },
        abort.signal,
        config.ollamaTimeout,
        activeTools,
        (chunk) => {
          setStreamingThinking((prev) => prev + chunk);
        }
      );

      // If no tool calls, check if we should continue or stop
      if (!result.toolCalls || result.toolCalls.length === 0) {
        finalContent = result.content;

        const assistantMessage: Message = {
          id: nextMsgId(),
          role: 'assistant',
          content: result.content,
          timestamp: Date.now(),
          thinking: result.thinking,
        };
        loopMessages = [...loopMessages, assistantMessage];

        // Check if there's an active plan with incomplete steps
        const plan = getCurrentPlan();
        if (plan && plan.approved) {
          const allDone = plan.steps.every((s) => s.status === 'completed' || s.status === 'failed');
          if (allDone) {
            // All steps done — clear plan and finish
            clearPlan();
            setCurrentPlan(null);
            break;
          }

          // Plan is incomplete — nudge the LLM to continue working
          const pending = plan.steps.filter((s) => s.status === 'pending' || s.status === 'in_progress');
          const completedCount = plan.steps.filter((s) => s.status === 'completed').length;
          const continuationPrompt: Message = {
            id: nextMsgId(),
            role: 'user',
            content: `You have an active plan "${plan.title}" with ${completedCount}/${plan.steps.length} steps completed. The following steps are still pending:\n${pending.map((s) => `- Step ${s.id}: ${s.title} (${s.status})`).join('\n')}\n\nContinue executing the remaining steps. Use update_plan_step to mark each step as in_progress when you start and completed when done.`,
            timestamp: Date.now(),
          };
          loopMessages = [...loopMessages, continuationPrompt];
          setMessages(loopMessages);

          // Continue the loop to re-prompt the LLM
          continue;
        }

        // No active plan or plan not yet approved — just finish
        break;
      }

      // Model wants to use tools
      const toolResults: ToolResult[] = [];
      const toolCallsInfo = result.toolCalls;

      for (const tc of toolCallsInfo) {
        setActiveToolName(formatToolCall(tc.name, tc.arguments));
        setStreamingContent('');

        // Special handling for create_plan: pause for approval
        if (tc.name === 'create_plan') {
          const toolResult = executeTool(tc.name, tc.arguments, cwd);
          toolResults.push(toolResult);

          if (toolResult.success) {
            const plan = getCurrentPlan();
            if (plan) {
              if (isAdminMode()) {
                // Admin mode: auto-approve plans without prompting
                plan.approved = true;
                syncPlan();
                toolResult.output += ' Plan auto-approved (admin mode). Now execute ALL steps without stopping.';
              } else {
                const { approved, specification } = await new Promise<{ approved: boolean; specification?: string }>((resolve) => {
                  setPendingPlanApproval({
                    plan: { ...plan, steps: plan.steps.map((s) => ({ ...s })) },
                    resolve: (a, s) => resolve({ approved: a, specification: s }),
                  });
                });
                setPendingPlanApproval(null);

                if (approved) {
                  plan.approved = true;
                  syncPlan();
                  toolResult.output += ' Plan approved by user. Now execute ALL steps without stopping — continue until every step is completed.';
                  if (specification) {
                    toolResult.output += ` User specification: ${specification}`;
                  }
                } else {
                  clearPlan();
                  setCurrentPlan(null);
                  toolResult.output = 'Plan rejected by user. Please revise or ask for clarification.';
                  toolResult.success = false;
                }
              }
            }
          }
          continue;
        }

        // Special handling for update_plan_step: sync UI
        if (tc.name === 'update_plan_step') {
          const toolResult = executeTool(tc.name, tc.arguments, cwd);
          toolResults.push(toolResult);
          syncPlan();
          continue;
        }

        // Special handling for browser: async execution via BrowserClient
        if (tc.name === 'browser') {
          const permission = checkPermission(tc.name);
          if (permission === 'denied') {
            toolResults.push({ name: 'browser', success: false, output: 'Permission denied.', duration: 0 });
            continue;
          }
          if (permission === 'needs_approval') {
            const { approved } = await new Promise<{ approved: boolean }>((resolve) => {
              setPendingPermission({
                toolName: tc.name,
                toolArgs: tc.arguments,
                resolve: (a) => resolve({ approved: a }),
              });
            });
            setPendingPermission(null);
            if (!approved) {
              toolResults.push({ name: 'browser', success: false, output: 'User denied permission.', duration: 0 });
              continue;
            }
          }
          const toolResult = await executeBrowser(tc.arguments, browserClientRef.current);
          toolResults.push(toolResult);
          continue;
        }

        // Special handling for jira: async execution
        if (tc.name === 'jira') {
          const toolResult = await executeJira(tc.arguments);
          toolResults.push(toolResult);
          continue;
        }

        // Special handling for delegate_to_agent: spawn sub-agent
        if (tc.name === 'delegate_to_agent' && agentModeActive) {
          const role = tc.arguments.role as AgentRole;
          const taskDescription = tc.arguments.task as string;
          const stepId = parseInt(String(tc.arguments.step_id || '0'), 10);

          // Determine model for this agent (coder may use override)
          let agentModel = currentModel;
          if (role === 'coder' && orchestrationSession?.coderModel) {
            agentModel = orchestrationSession.coderModel;
          }

          setActiveToolName(`[${role.toUpperCase()}] ${taskDescription.slice(0, 50)}...`);

          // Mark plan step as in_progress
          if (stepId > 0) {
            updateStepStatus(stepId, 'in_progress');
            syncPlan();
          }

          const toolResult = await executeDelegation({
            role,
            taskDescription,
            stepId,
            provider: providerRef.current,
            model: agentModel,
            config,
            cwd,
            projectContext: projectContext.current,
            abortSignal: abort.signal,
            onPermissionNeeded: async (toolName, toolArgs) => {
              return new Promise((resolve) => {
                setPendingPermission({
                  toolName: `[${role}] ${toolName}`,
                  toolArgs,
                  resolve: (a, n) => resolve({ approved: a, note: n }),
                });
              });
            },
            onChunk: (chunk) => {
              setStreamingContent((prev) => prev + chunk);
            },
          });

          toolResults.push(toolResult);

          // Auto-update plan step based on result
          if (stepId > 0) {
            updateStepStatus(stepId, toolResult.success ? 'completed' : 'failed');
            syncPlan();
          }

          continue;
        }

        // Normal tool permission check
        const permission = checkPermission(tc.name);

        if (permission === 'denied') {
          toolResults.push({
            name: tc.name,
            success: false,
            output: 'Permission denied for this tool.',
            duration: 0,
          });
          continue;
        }

        if (permission === 'needs_approval') {
          const { approved, note } = await new Promise<{ approved: boolean; note?: string }>((resolve) => {
            setPendingPermission({
              toolName: tc.name,
              toolArgs: tc.arguments,
              resolve: (a, n) => resolve({ approved: a, note: n }),
            });
          });
          setPendingPermission(null);

          if (!approved) {
            toolResults.push({
              name: tc.name,
              success: false,
              output: 'User denied permission.',
              duration: 0,
            });
            continue;
          }

          // Execute the tool (approved, possibly with user note)
          const toolResult = executeTool(tc.name, tc.arguments, cwd);
          if (note && toolResult.success) {
            toolResult.output = (toolResult.output || '') + `\nUser note: ${note}`;
          }
          toolResults.push(toolResult);
          continue;
        }

        // Execute the tool
        const toolResult = executeTool(tc.name, tc.arguments, cwd);
        toolResults.push(toolResult);
      }

      setActiveToolName(undefined);

      // Attach plan to message if one was created in this iteration
      const activePlan = getCurrentPlan();
      const assistantToolMessage: Message = {
        id: nextMsgId(),
        role: 'assistant',
        content: result.content,
        timestamp: Date.now(),
        toolCalls: toolCallsInfo,
        toolResults,
        plan: activePlan ? { ...activePlan, steps: activePlan.steps.map((s) => ({ ...s })) } : undefined,
        thinking: result.thinking,
      };
      loopMessages = [...loopMessages, assistantToolMessage];

      // Add tool result messages
      for (let i = 0; i < toolCallsInfo.length; i++) {
        const toolMessage: Message = {
          id: nextMsgId(),
          role: 'tool',
          content: JSON.stringify({
            name: toolCallsInfo[i].name,
            result: toolResults[i]?.output || 'No result',
            success: toolResults[i]?.success ?? false,
          }),
          timestamp: Date.now(),
        };
        loopMessages = [...loopMessages, toolMessage];
      }

      setMessages(loopMessages);
    }

    return { finalMessages: loopMessages, finalContent };
  }, [config, cwd, syncPlan, agentModeActive, orchestrationSession, browserConnected]);

  const handleUserInput = useCallback(async (input: string, fromQueue = false) => {
    if (!fromQueue) setInputKey((k) => k + 1);
    setError('');
    setCommandOutput('');

    // Handle slash commands
    if (isSlashCommand(input)) {
      const result = await executeCommand(input, {
        messages,
        model,
        config,
        cwd,
        provider: providerRef.current,
        setMessages: (msgs) => {
          setMessages(msgs);
        },
        setModel: (m) => {
          setModel(m);
          setSelectedModel(m);
        },
        setProvider: (p) => {
          providerRef.current = p;
        },
        exit: () => process.exit(0),
      });

      if (result.action === 'exit') {
        process.exit(0);
        return;
      }
      if (result.output) setCommandOutput(result.output);
      if (result.action === 'model-pick') {
        setShowModelPicker(true);
      }
      if (result.action === 'session-pick') {
        setShowSessionPicker(true);
      }
      if (result.action === 'view-diff' && result.messageId) {
        setViewingDiffMessageId(result.messageId);
      }
      if (result.action === 'agent-mode-on') {
        setAgentModeActive(true);
      }
      if (result.action === 'agent-mode-off') {
        setAgentModeActive(false);
        clearOrchestrationSession();
        setOrchestrationSession(null);
      }
      if (result.action === 'browser-start') {
        await startBrowserServer();
      }
      if (result.action === 'browser-stop') {
        await stopBrowserServer();
      }
      if (result.action === 'telegram-start') {
        await startTelegramBot();
      }
      if (result.action === 'telegram-stop') {
        await stopTelegramBot();
      }
      return;
    }

    if (!model) {
      setError('No model selected. Use /model to select one.');
      return;
    }

    // Clear any previous plan/agent session for new task (not for queued continuations)
    if (!fromQueue) {
      clearPlan();
      setCurrentPlan(null);
      if (agentModeActive) {
        clearOrchestrationSession();
        setAgentModeActive(false);
        setOrchestrationSession(null);
      }
    }

    // Auto-detect complex tasks and offer agent mode
    if (!fromQueue && !agentModeActive) {
      const complexity = analyzeComplexity(input);
      if (complexity.isComplex) {
        if (isAdminMode()) {
          // Admin mode: auto-accept agent mode with sequential execution
          setAgentModeActive(true);
          const session = startOrchestrationSession('sequential', model);
          setOrchestrationSession(session);
        } else {
          const agentConfig = await new Promise<{ executionMode: ExecutionMode; coderModel: string } | null>(
            (resolve) => {
              setPendingAgentMode({ reason: complexity.reason, resolve });
            },
          );
          setPendingAgentMode(null);

          if (agentConfig) {
            setAgentModeActive(true);
            const session = startOrchestrationSession(
              agentConfig.executionMode,
              agentConfig.coderModel,
            );
            setOrchestrationSession(session);
          }
        }
      }
    }

    // Resolve file attachments
    const { cleanInput, attachments, errors } = resolveFileReferences(input, cwd);
    if (errors.length > 0) {
      setError(errors.join('\n'));
    }

    const fileContext = buildFileContext(attachments);
    const fullContent = cleanInput + fileContext;

    const userMessage: Message = {
      id: nextMsgId(),
      role: 'user',
      content: input,
      timestamp: Date.now(),
      attachments: attachments.length > 0 ? attachments : undefined,
    };

    const updatedMessages = [...messages, userMessage];
    setMessages(updatedMessages);
    setIsStreaming(true);
    setStreamingContent('');

    const ollamaMessages: Message[] = [
      ...messages,
      { ...userMessage, content: fullContent },
    ];

    const abort = new AbortController();
    abortRef.current = abort;

    try {
      const { finalMessages } = await runToolLoop(ollamaMessages, model, abort);

      const newMessages = finalMessages.slice(messages.length);
      if (newMessages.length > 0 && newMessages[0].role === 'user') {
        newMessages[0] = { ...newMessages[0], content: input, attachments: attachments.length > 0 ? attachments : undefined };
      }
      const allMessages = [...messages, ...newMessages];

      setMessages(allMessages);
      persistMessages(allMessages, model);
      saveSession(allMessages, model);

      // Auto-compact when over threshold; preserve current plan in summary so we can continue
      if (shouldCompact(allMessages, config)) {
        const plan = getCurrentPlan();
        const compacted = await compactMessages(allMessages, model, config, providerRef.current, plan ?? undefined);
        if (compacted) {
          setMessages(compacted.messages);
          persistMessages(compacted.messages, model);
          setCommandOutput('\x1b[33mConversation auto-compacted to save context. Plan (if any) is preserved.\x1b[0m');
        }
      }
    } catch (err) {
      if (err instanceof Error && err.name === 'AbortError') {
        if (streamingContent) {
          const partialMessage: Message = {
            id: nextMsgId(),
            role: 'assistant',
            content: streamingContent + '\n\n*[cancelled]*',
            timestamp: Date.now(),
          };
          const finalMessages = [...updatedMessages, partialMessage];
          setMessages(finalMessages);
          persistMessages(finalMessages, model);
        }
      } else {
        const errorMsg = err instanceof Error ? err.message : 'Failed to get response';
        setError(errorMsg);
      }
    } finally {
      setIsStreaming(false);
      setStreamingContent('');
      setStreamingThinking('');
      setActiveToolName(undefined);
      abortRef.current = null;
    }
  }, [messages, model, config, cwd, streamingContent, runToolLoop]);

  const handleCancel = useCallback(() => {
    abortRef.current?.abort();
  }, []);

  // Handle input submitted while AI is streaming
  const handleInputDuringStreaming = useCallback((input: string) => {
    setInputKey((k) => k + 1);

    if (isSlashCommand(input)) {
      const cmdName = input.slice(1).split(/\s+/)[0].toLowerCase();
      if (SAFE_STREAMING_COMMANDS.has(cmdName)) {
        // Execute safe commands immediately
        executeCommand(input, {
          messages,
          model,
          config,
          cwd,
          provider: providerRef.current,
          setMessages: (msgs) => setMessages(msgs),
          setModel: (m) => { setModel(m); setSelectedModel(m); },
          setProvider: (p) => { providerRef.current = p; },
          exit: () => process.exit(0),
        }).then((result) => {
          if (result.action === 'exit') { process.exit(0); return; }
          if (result.output) setCommandOutput(result.output);
        });
      } else {
        setCommandOutput(`\x1b[33mCannot run /${cmdName} while processing. Wait for completion or press Ctrl+C to stop.\x1b[0m`);
      }
      return;
    }

    // Queue the message for processing after streaming ends
    queueRef.current.push(input);
    setQueueCount(queueRef.current.length);
    setCommandOutput(`\x1b[36mQueued message (${queueRef.current.length} in queue). Will process after current response.\x1b[0m`);
  }, [messages, model, config, cwd]);

  // Unified submit handler — delegates based on streaming state
  const handleSubmit = useCallback((input: string) => {
    if (isStreaming) {
      handleInputDuringStreaming(input);
    } else {
      handleUserInput(input);
    }
  }, [isStreaming, handleInputDuringStreaming, handleUserInput]);

  const handleModelSelect = useCallback((selectedModel: string) => {
    setModel(selectedModel);
    setSelectedModel(selectedModel);
    setShowModelPicker(false);

    // Check if we already know the context length from the models list
    const modelInfo = models.find((m) => m.name === selectedModel);
    if (modelInfo?.contextLength && modelInfo.contextLength > 0) {
      config.contextWindowSize = modelInfo.contextLength;
      setCommandOutput(`\x1b[32mSwitched to model: \x1b[1m${selectedModel}\x1b[0m \x1b[90m(${Math.round(modelInfo.contextLength / 1000)}K context)\x1b[0m`);
    } else {
      providerRef.current.getModelContextLength(selectedModel).then((ctxLen) => {
        config.contextWindowSize = ctxLen;
        setCommandOutput(`\x1b[32mSwitched to model: \x1b[1m${selectedModel}\x1b[0m \x1b[90m(${Math.round(ctxLen / 1000)}K context)\x1b[0m`);
      });
    }
  }, [config, models]);

  const handlePermissionDecision = useCallback((approved: boolean, note?: string) => {
    if (pendingPermission) {
      pendingPermission.resolve(approved, note);
    }
  }, [pendingPermission]);

  const handlePlanApproval = useCallback((approved: boolean, specification?: string) => {
    if (pendingPlanApproval) {
      pendingPlanApproval.resolve(approved, specification);
    }
  }, [pendingPlanApproval]);

  // Slash command menu handlers
  const handleSlashPress = useCallback(() => {
    if (!pendingPermission && !pendingPlanApproval) {
      setShowCommandMenu(true);
      setInputKey((k) => k + 1);
    }
  }, [pendingPermission, pendingPlanApproval]);

  const handleCommandSelect = useCallback((command: string) => {
    setShowCommandMenu(false);
    setInputKey((k) => k + 1);
    handleUserInput(command);
  }, [handleUserInput]);

  const handleCommandMenuClose = useCallback(() => {
    setShowCommandMenu(false);
    setInputKey((k) => k + 1);
  }, []);

  const handleModelSwitch = useCallback(() => {
    setShowModelPicker(true);
  }, []);

  const handleSessionSelect = useCallback((sessionId: string) => {
    const session = resumeSessionById(sessionId);
    if (session) {
      setMessages(session.messages);
      setCommandOutput(`\x1b[32mResumed: \x1b[1m${session.name}\x1b[0m`);
    }
    setShowSessionPicker(false);
  }, []);

  // Auto-process queued messages when streaming ends
  useEffect(() => {
    if (wasStreamingRef.current && !isStreaming && queueRef.current.length > 0) {
      const next = queueRef.current.shift()!;
      setQueueCount(queueRef.current.length);
      handleUserInput(next, true);
    }
    wasStreamingRef.current = isStreaming;
  }, [isStreaming, handleUserInput]);

  // Cleanup effect to flush pending saves and stop servers
  useEffect(() => {
    return () => {
      flushPendingSave();
      if (browserServerRef.current) {
        browserServerRef.current.stop();
      }
      if (telegramBotRef.current) {
        telegramBotRef.current.stop();
      }
    };
  }, []);

  // Global keyboard shortcuts
  useInput((input, key) => {
    // Esc: close diff viewer
    if (key.escape && viewingDiffMessageId) {
      setViewingDiffMessageId(null);
      return;
    }
    // Ctrl+Shift+C: copy selected message
    if (key.ctrl && key.shift && input === 'C') {
      if (selectedMessageId) {
        const message = messages.find(m => m.id === selectedMessageId);
        if (message && message.content) {
          copyToClipboard(message.content);
          setCommandOutput('\x1b[32mMessage copied to clipboard!\x1b[0m');
        }
      }
    }
  });

  const tokenCount = useMemo(() => countMessageTokens(messages), [messages]);
  const planProgress = useMemo(
    () =>
      currentPlan && currentPlan.approved
        ? `${currentPlan.steps.filter((s) => s.status === 'completed').length}/${currentPlan.steps.length}`
        : undefined,
    [currentPlan]
  );

  if (showModelPicker) {
    return (
      <ModelPicker
        models={models}
        currentModel={model}
        provider={providerRef.current}
        onSelect={handleModelSelect}
        onCancel={() => setShowModelPicker(false)}
      />
    );
  }

  if (showSessionPicker) {
    const sessionItems = listSessions().map((s) => ({
      id: s.id,
      name: s.name,
      messageCount: s.messages.length,
      date: new Date(s.updatedAt).toLocaleDateString(),
    }));
    return (
      <SessionPicker
        sessions={sessionItems}
        onSelect={handleSessionSelect}
        onCancel={() => setShowSessionPicker(false)}
      />
    );
  }

  return (
    <Box flexDirection="column">
      {/* Animated welcome — only shown before any messages */}
      {messages.length === 0 && (
        <Welcome
          model={model}
          cwd={cwd}
          onAnimationDone={() => setAnimationDone(true)}
          yolo={isYoloMode()}
        />
      )}

      {/* Message history + streaming (includes static banner as first item) */}
      {messages.length > 0 && (
        <MessageList
          messages={messages}
          streamingContent={streamingContent}
          streamingThinking={streamingThinking}
          isStreaming={isStreaming}
          activeToolName={activeToolName}
          model={model}
          cwd={cwd}
          yolo={isYoloMode()}
          setSelectedMessageId={setSelectedMessageId}
          onViewDiff={setViewingDiffMessageId}
        />
      )}

      {/* Live task tracker during plan execution — agent-aware */}
      {currentPlan && currentPlan.approved && isStreaming && orchestrationSession && (
        <AgentTracker plan={currentPlan} session={orchestrationSession} />
      )}
      {currentPlan && currentPlan.approved && isStreaming && !orchestrationSession && (
        <TaskTracker plan={currentPlan} />
      )}

      {/* Agent mode prompt (auto-detect asks user) */}
      {pendingAgentMode && (
        <AgentModePrompt
          reason={pendingAgentMode.reason}
          models={models}
          currentModel={model}
          onConfirm={(agentConfig) => pendingAgentMode.resolve(agentConfig)}
          onCancel={() => pendingAgentMode.resolve(null)}
        />
      )}

      {/* Plan approval prompt */}
      {pendingPlanApproval && (
        <PlanDisplay
          plan={pendingPlanApproval.plan}
          showApproval={true}
          onApprove={() => handlePlanApproval(true)}
          onReject={() => handlePlanApproval(false)}
          onOther={(spec) => handlePlanApproval(true, spec)}
        />
      )}

      {/* Permission prompt */}
      {pendingPermission && !pendingPlanApproval && (
        <PermissionPrompt
          toolName={pendingPermission.toolName}
          toolArgs={pendingPermission.toolArgs}
          onDecision={handlePermissionDecision}
        />
      )}

      {/* Command output */}
      {commandOutput && (
        <Box paddingX={1} marginY={0}>
          <Text>{commandOutput}</Text>
        </Box>
      )}

      {/* Error display */}
      {error && (
        <Box paddingX={1}>
          <Text color="red">Error: {error}</Text>
        </Box>
      )}

      {/* Status bar — show whenever we have messages so YOLO/model stay visible (including while streaming) */}
      {messages.length > 0 && (
        <StatusBar
          model={model}
          tokenCount={tokenCount}
          contextLimit={config.contextWindowSize}
          yolo={isYoloMode()}
          planProgress={planProgress}
          isStreaming={isStreaming}
          provider={config.provider}
          agentMode={agentModeActive}
          adminMode={isAdminMode()}
          browserConnected={browserConnected}
          telegramRunning={telegramRunning}
        />
      )}

      {/* Slash command menu */}
      {showCommandMenu && (
        <SlashCommandMenu
          onSelect={handleCommandSelect}
          onClose={handleCommandMenuClose}
        />
      )}

      {/* Full diff viewer (from /diff or [View diff] on a message) */}
      {viewingDiffMessageId && (
        <DiffViewer
          message={messages.find((m) => m.id === viewingDiffMessageId) ?? null}
          onClose={() => setViewingDiffMessageId(null)}
        />
      )}

      {/* Visual anchor above input — keeps "bottom" stable when content updates */}
      {messages.length > 0 && !showCommandMenu && !pendingPermission && !pendingPlanApproval && (
        <Box paddingX={1} marginY={0}>
          <Text dimColor>{'─'.repeat(Math.min(process.stdout.columns - 2 || 40, 50))}</Text>
        </Box>
      )}

      {/* Input */}
      {!showCommandMenu && !pendingPermission && !pendingPlanApproval && (
        <PromptInput
          onSubmit={handleSubmit}
          isStreaming={isStreaming}
          onCancel={handleCancel}
          onSlashPress={handleSlashPress}
          onModelSwitch={handleModelSwitch}
          inputKey={inputKey}
          queueCount={queueCount}
        />
      )}

      {/* Bottom keyboard shortcut bar */}
      <BottomBar isStreaming={isStreaming} yolo={isYoloMode()} />
    </Box>
  );
}
