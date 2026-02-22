import type { Message, ConversationData, Plan } from '../types/index.js';
import { getSavedConversation, saveConversation, clearConversation as clearSaved } from '../cli/config.js';

let currentId: string = '';
let lastSaveTime = 0;
const SAVE_DEBOUNCE_DELAY = 1000; // 1 second debounce
let saveTimeout: NodeJS.Timeout | null = null;
let pendingSave: { messages: Message[]; model: string; plan?: Plan } | null = null;

export function loadMessages(): Message[] {
  const data = getSavedConversation();
  if (data) {
    currentId = data.id;
    return data.messages;
  }
  return [];
}

export function persistMessages(messages: Message[], model: string, plan?: Plan): void {
  // Update pending save data
  pendingSave = { messages, model, plan };

  // Clear existing timeout
  if (saveTimeout) {
    clearTimeout(saveTimeout);
  }

  const now = Date.now();
  const timeSinceLastSave = now - lastSaveTime;

  // If enough time has passed since last save, save immediately
  if (timeSinceLastSave >= SAVE_DEBOUNCE_DELAY) {
    performSave(messages, model, plan);
  } else {
    // Otherwise, schedule save after remaining delay
    const delay = SAVE_DEBOUNCE_DELAY - timeSinceLastSave;
    saveTimeout = setTimeout(() => {
      if (pendingSave) {
        performSave(pendingSave.messages, pendingSave.model, pendingSave.plan);
      }
    }, delay);
  }
}

function performSave(messages: Message[], model: string, plan?: Plan): void {
  lastSaveTime = Date.now();
  if (saveTimeout) {
    clearTimeout(saveTimeout);
    saveTimeout = null;
  }
  pendingSave = null;

  if (!currentId) {
    currentId = `conv-${Date.now()}`;
  }

  const data: ConversationData = {
    id: currentId,
    messages,
    model,
    createdAt: messages.length > 0 ? messages[0].timestamp : Date.now(),
    updatedAt: Date.now(),
    ...(plan ? { plan } : {}),
  };

  saveConversation(data);
}

export function clearMessages(): void {
  currentId = '';
  if (saveTimeout) {
    clearTimeout(saveTimeout);
    saveTimeout = null;
  }
  pendingSave = null;
  clearSaved();
}

export function newConversation(): void {
  currentId = `conv-${Date.now()}`;
  if (saveTimeout) {
    clearTimeout(saveTimeout);
    saveTimeout = null;
  }
  pendingSave = null;
  clearSaved();
}

// Force immediate save (for critical operations)
export function flushPendingSave(): void {
  if (saveTimeout) {
    clearTimeout(saveTimeout);
    saveTimeout = null;
  }
  
  if (pendingSave) {
    performSave(pendingSave.messages, pendingSave.model, pendingSave.plan);
  }
}
