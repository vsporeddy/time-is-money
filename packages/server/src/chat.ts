import type { ChatMessage } from 'shared';
import type { Room } from './rooms.js';

const MAX_HISTORY = 100;

export function getChatHistory(room: Room): ChatMessage[] {
  return room.chat;
}

export function addChatMessage(room: Room, name: string, text: string): ChatMessage | null {
  const cleanName = name.trim().slice(0, 20) || 'Guest';
  const cleanText = text.trim().slice(0, 300);
  if (!cleanText) return null;

  room.chatCounter += 1;
  const message: ChatMessage = { id: `chat-${room.chatCounter}`, name: cleanName, text: cleanText, ts: Date.now() };

  room.chat.push(message);
  if (room.chat.length > MAX_HISTORY) room.chat.shift();

  return message;
}

export function addSystemChatMessage(room: Room, text: string): ChatMessage {
  room.chatCounter += 1;
  const message: ChatMessage = {
    id: `chat-${room.chatCounter}`,
    name: '',
    text,
    ts: Date.now(),
    system: true,
  };

  room.chat.push(message);
  if (room.chat.length > MAX_HISTORY) room.chat.shift();

  return message;
}
