import type { ChatMessage } from 'shared';

const MAX_HISTORY = 100;
const history: ChatMessage[] = [];
let counter = 0;

export function getChatHistory(): ChatMessage[] {
  return history;
}

export function addChatMessage(name: string, text: string): ChatMessage | null {
  const cleanName = name.trim().slice(0, 20) || 'Guest';
  const cleanText = text.trim().slice(0, 300);
  if (!cleanText) return null;

  counter += 1;
  const message: ChatMessage = { id: `chat-${counter}`, name: cleanName, text: cleanText, ts: Date.now() };

  history.push(message);
  if (history.length > MAX_HISTORY) history.shift();

  return message;
}
