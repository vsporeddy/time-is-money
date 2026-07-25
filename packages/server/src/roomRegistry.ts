import { randomInt } from 'node:crypto';
import { ROOM_CODE_ALPHABET, ROOM_CODE_LENGTH } from 'shared';
import { createRoomObject } from './rooms.js';
import type { Room } from './rooms.js';
import { resetRoomToLobby } from './round.js';

// Lives in its own module rather than in rooms.ts: deleting a room has to
// clear its timers via resetRoomToLobby, and round.ts already imports rooms.ts.

const rooms = new Map<string, Room>();

// Cheap memory bound for a public server. Well above any plausible concurrent load.
export const MAX_ROOMS = 500;
// How long an emptied room sticks around before deletion, so a refresh or a
// brief disconnect doesn't invalidate everyone's share link.
export const EMPTY_GRACE_MS = 120_000;

function randomCode(length: number): string {
  let code = '';
  for (let i = 0; i < length; i += 1) code += ROOM_CODE_ALPHABET[randomInt(ROOM_CODE_ALPHABET.length)];
  return code;
}

function generateCode(): string {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    const code = randomCode(ROOM_CODE_LENGTH);
    if (!rooms.has(code)) return code;
  }
  // Pathological collision run — widen the space rather than loop forever.
  let code = randomCode(ROOM_CODE_LENGTH + 1);
  while (rooms.has(code)) code = randomCode(ROOM_CODE_LENGTH + 1);
  return code;
}

// Returns null when the server is already hosting MAX_ROOMS lobbies.
export function createRoom(): Room | null {
  if (rooms.size >= MAX_ROOMS) return null;
  const room = createRoomObject(generateCode());
  rooms.set(room.code, room);
  return room;
}

export function getRoomByCode(code: string): Room | undefined {
  return rooms.get(code);
}

export function deleteRoom(code: string) {
  const room = rooms.get(code);
  if (!room) return;
  resetRoomToLobby(room); // belt-and-braces: clear any timer still pending
  rooms.delete(code);
}

export function allRooms(): IterableIterator<Room> {
  return rooms.values();
}

export function roomCount(): number {
  return rooms.size;
}

export function playerCount(): number {
  let total = 0;
  for (const room of rooms.values()) total += room.players.size;
  return total;
}

export function reapEmptyRooms(now = Date.now()) {
  for (const [code, room] of rooms) {
    if (room.emptySince !== null && now - room.emptySince > EMPTY_GRACE_MS) deleteRoom(code);
  }
}
