import express from 'express';
import { createServer } from 'node:http';
import { Server } from 'socket.io';
import type { DefaultEventsMap } from 'socket.io';
import type { ClientToServerEvents, Player, ServerToClientEvents } from 'shared';
import { getClassDefinition, MAX_PLAYERS_PER_ROOM, normalizeRoomCode, pickAvailableClassId } from 'shared';
import { emitRoomState, humanCount, isHost, toRoomState } from './rooms.js';
import type { AppSocket, Room, SocketData } from './rooms.js';
import { allRooms, createRoom, getRoomByCode, playerCount, reapEmptyRooms, roomCount } from './roomRegistry.js';
import { addBot, removeBot } from './bots.js';
import {
  forceResetGame,
  handleHoldRelease,
  handleHoldStart,
  resetRoomToLobby,
  restartGame,
  startGame,
  tickRoom,
  useMirror,
  useWeapon,
} from './round.js';
import { addChatMessage, getChatHistory } from './chat.js';

const app = express();
const httpServer = createServer(app);

const io = new Server<ClientToServerEvents, ServerToClientEvents, DefaultEventsMap, SocketData>(httpServer, {
  cors: { origin: '*' },
});

app.get('/health', (_req, res) => {
  res.json({ ok: true, rooms: roomCount(), players: playerCount() });
});

// A socket belongs to exactly one room, recorded on join. Every handler below
// resolves it from there rather than trusting a code in the payload.
function roomOf(socket: AppSocket): Room | undefined {
  const code = socket.data.roomCode;
  return code ? getRoomByCode(code) : undefined;
}

// Host-only actions. Non-hosts are silently ignored — the client already hides
// these controls, and these events are fire-and-forget with no ack to fail.
function hostRoom(socket: AppSocket): Room | undefined {
  const room = roomOf(socket);
  return room && isHost(room, socket.id) ? room : undefined;
}

io.on('connection', (socket: AppSocket) => {
  socket.on('send_chat', ({ name, text }) => {
    const room = roomOf(socket);
    if (!room) return;
    const message = addChatMessage(room, name, text);
    if (message) io.to(room.code).emit('chat_message', message);
  });

  socket.on('join_room', ({ playerName, code }, ack) => {
    const name = playerName.trim().slice(0, 20);

    if (!name) {
      ack({ ok: false, reason: 'invalid_name', error: 'Name is required.' });
      return;
    }

    if (socket.data.roomCode) {
      ack({ ok: false, reason: 'invalid_code', error: 'Already in a lobby.' });
      return;
    }

    let room: Room | undefined;
    if (code) {
      const normalized = normalizeRoomCode(code);
      if (!normalized) {
        ack({ ok: false, reason: 'invalid_code', error: "That doesn't look like a lobby code." });
        return;
      }
      room = getRoomByCode(normalized);
      if (!room) {
        ack({ ok: false, reason: 'not_found', error: "That lobby has expired or doesn't exist." });
        return;
      }
    } else {
      // No code — this player is starting a fresh lobby of their own.
      room = createRoom() ?? undefined;
      if (!room) {
        ack({ ok: false, reason: 'server_full', error: 'The server is too busy to open a new lobby. Try again shortly.' });
        return;
      }
    }

    const classId = pickAvailableClassId([...room.players.values()].map((p) => p.classId));
    if (!classId) {
      ack({ ok: false, reason: 'room_full', error: `This lobby is full — ${MAX_PLAYERS_PER_ROOM} players max.` });
      return;
    }

    const isObserver = room.status !== 'lobby';

    const player: Player = {
      id: socket.id,
      name,
      timeRemainingMs: isObserver ? 0 : room.settings.startingTimeMs,
      status: 'active',
      stash: [],
      connected: true,
      portraitIndex: getClassDefinition(classId)!.portraitIndex,
      classId,
      winStreak: 0,
      isObserver,
      isBot: false,
    };
    room.players.set(player.id, player);

    socket.data.roomCode = room.code;
    socket.join(room.code);
    room.emptySince = null;

    // Whoever arrives to a hostless room takes it over — covers both creating
    // a lobby and walking into one the previous host abandoned.
    if (room.hostId === null || !room.players.has(room.hostId)) room.hostId = player.id;

    ack({ ok: true, code: room.code, playerId: player.id, state: toRoomState(room, player.id) });
    socket.emit('chat_history', getChatHistory(room));
    emitRoomState(room, io);
  });

  socket.on('start_game', () => {
    const room = hostRoom(socket);
    if (room) startGame(room, io);
  });

  socket.on('add_bot', () => {
    const room = hostRoom(socket);
    if (room && addBot(room)) emitRoomState(room, io);
  });

  socket.on('remove_bot', () => {
    const room = hostRoom(socket);
    if (room && removeBot(room)) emitRoomState(room, io);
  });

  socket.on('hold_start', () => {
    const room = roomOf(socket);
    if (room) handleHoldStart(room, socket.id, io);
  });

  socket.on('hold_release', () => {
    const room = roomOf(socket);
    if (room) handleHoldRelease(room, socket.id, io);
  });

  socket.on('set_round_limit', ({ maxRounds }) => {
    const room = hostRoom(socket);
    if (!room || room.status !== 'lobby') return;

    const rounded = Math.round(maxRounds);
    if (!Number.isFinite(rounded) || rounded < 10 || rounded > 25) return;
    room.settings.maxRounds = rounded;
    emitRoomState(room, io);
  });

  socket.on('restart_game', () => {
    const room = hostRoom(socket);
    if (room) restartGame(room, io);
  });

  socket.on('reset_game', () => {
    const room = hostRoom(socket);
    if (room) forceResetGame(room, io);
  });

  socket.on('use_mirror', ({ itemId, copyItemId }, ack) => {
    const room = roomOf(socket);
    if (!room) {
      ack({ ok: false, error: 'Not in a lobby.' });
      return;
    }
    const result = useMirror(room, socket.id, itemId, copyItemId);
    ack(result);
    if (result.ok) emitRoomState(room, io);
  });

  socket.on('use_weapon', ({ itemId, targetPlayerId, targetItemId }, ack) => {
    const room = roomOf(socket);
    if (!room) {
      ack({ ok: false, error: 'Not in a lobby.' });
      return;
    }
    ack(useWeapon(room, io, socket.id, itemId, targetPlayerId, targetItemId));
  });

  socket.on('disconnect', () => {
    const room = roomOf(socket);
    socket.data.roomCode = undefined;
    if (!room || !room.players.has(socket.id)) return;

    handleHoldRelease(room, socket.id, io); // don't leave them stuck "holding" if they vanish mid-round
    room.players.delete(socket.id);

    // Longest-tenured remaining human inherits the room (Map keeps insertion
    // order). A bot can never be host — it has no socket to press Start with.
    if (room.hostId === socket.id) {
      room.hostId = [...room.players.values()].find((p) => !p.isBot)?.id ?? null;
    }

    if (humanCount(room) === 0) {
      // Nobody left to play with. A returning player gets a new socket id and
      // so a new identity anyway, which makes a half-finished round
      // unresolvable — a clean lobby on the same code is the only coherent
      // state to hold open. Chat and the round limit survive; the reaper
      // deletes the whole room once the grace period lapses.
      resetRoomToLobby(room);
      for (const [id, player] of room.players) {
        if (player.isBot) room.players.delete(id);
      }
      room.hostId = null;
      room.emptySince = Date.now();
      return;
    }

    emitRoomState(room, io);
  });
});

// One tick loop drives every room's live countdown. Per-room intervals would
// need lifecycle-perfect teardown, and a leaked one would pin its whole Room
// forever; tickRoom early-returns for idle rooms, so this stays cheap.
setInterval(() => {
  for (const room of allRooms()) {
    try {
      tickRoom(room, io);
    } catch (err) {
      // One room's failure must not take down everyone else's game.
      console.error(`tick failed for room ${room.code}`, err);
    }
  }
}, 100);

setInterval(() => reapEmptyRooms(), 30_000);

const PORT = Number(process.env.PORT) || 8080;
httpServer.listen(PORT, () => {
  console.log(`Server listening on :${PORT}`);
});
