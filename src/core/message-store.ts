import type { Message, ConversationData } from '../types/index.js';
import { getSavedConversation, saveConversation, clearConversation as clearSaved } from '../cli/config.js';

let currentId: string = '';
let lastSaveTime = 0;
const SAVE_DEBOUNCE_DELAY = 1000; // 1 second debounce
let saveTimeout: NodeJS.Timeout | null = null;
let pendingSave: { messages: Message[]; model: string } | null = null;

export function loadMessages(): Message[] {
  const data = getSavedConversation();
  if (data) {
    currentId = data.id;
    return data.messages;
  }
  return [];
}

export function persistMessages(messages: Message[], model: string): void {
  // Update pending save data
  pendingSave = { messages, model };
  
  // Clear existing timeout
  if (saveTimeout) {
    clearTimeout(saveTimeout);
  }
  
  const now = Date.now();
  const timeSinceLastSave = now - lastSaveTime;
  
  // If enough time has passed since last save, save immediately
  if (timeSinceLastSave >= SAVE_DEBOUNCE_DELAY) {
    performSave(messages, model);
  } else {
    // Otherwise, schedule save after remaining delay
    const delay = SAVE_DEBOUNCE_DELAY - timeSinceLastSave;
    saveTimeout = setTimeout(() => {
      if (pendingSave) {
        performSave(pendingSave.messages, pendingSave.model);
      }
    }, delay);
  }
}

function performSave(messages: Message[], model: string): void {
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
    performSave(pendingSave.messages, pendingSave.model);
  }
}
