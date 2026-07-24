import express from 'express';
import { createServer } from 'node:http';
import { Server } from 'socket.io';
import type { ClientToServerEvents, Player, ServerToClientEvents } from 'shared';
import { randomPortraitIndex } from 'shared';
import { emitRoomState, getRoom, toRoomState } from './rooms.js';
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
} from './round.js';
import { addChatMessage, getChatHistory } from './chat.js';

const app = express();
const httpServer = createServer(app);

const io = new Server<ClientToServerEvents, ServerToClientEvents>(httpServer, {
  cors: { origin: '*' },
});

app.get('/health', (_req, res) => {
  res.send('ok');
});

io.on('connection', (socket) => {
  socket.emit('chat_history', getChatHistory());
  socket.emit('room_state', toRoomState(getRoom())); // so the join screen can tell a game is already running

  socket.on('send_chat', ({ name, text }) => {
    const message = addChatMessage(name, text);
    if (message) io.emit('chat_message', message);
  });

  socket.on('join_room', ({ playerName }, ack) => {
    const name = playerName.trim().slice(0, 20);

    if (!name) {
      ack({ ok: false, error: 'Name is required.' });
      return;
    }

    const room = getRoom();
    const isObserver = room.status !== 'lobby';

    const player: Player = {
      id: socket.id,
      name,
      timeRemainingMs: isObserver ? 0 : room.settings.startingTimeMs,
      status: 'active',
      stash: [],
      connected: true,
      portraitIndex: randomPortraitIndex(),
      isObserver,
      isBot: false,
    };
    room.players.set(player.id, player);

    ack({ ok: true, playerId: player.id });
    emitRoomState(room, io);
  });

  socket.on('start_game', () => {
    startGame(getRoom(), io);
  });

  socket.on('add_bot', () => {
    const room = getRoom();
    if (addBot(room)) emitRoomState(room, io);
  });

  socket.on('remove_bot', () => {
    const room = getRoom();
    if (removeBot(room)) emitRoomState(room, io);
  });

  socket.on('hold_start', () => {
    handleHoldStart(getRoom(), socket.id, io);
  });

  socket.on('hold_release', () => {
    handleHoldRelease(getRoom(), socket.id, io);
  });

  socket.on('set_round_limit', ({ maxRounds }) => {
    const room = getRoom();
    if (room.status !== 'lobby') return;

    const rounded = Math.round(maxRounds);
    if (!Number.isFinite(rounded) || rounded < 5 || rounded > 20) return;
    room.settings.maxRounds = rounded;
    emitRoomState(room, io);
  });

  socket.on('restart_game', () => {
    restartGame(getRoom(), io);
  });

  socket.on('reset_game', () => {
    forceResetGame(getRoom(), io);
  });

  socket.on('use_mirror', ({ itemId, copyItemId }, ack) => {
    const room = getRoom();
    const result = useMirror(room, socket.id, itemId, copyItemId);
    ack(result);
    if (result.ok) emitRoomState(room, io);
  });

  socket.on('disconnect', () => {
    const room = getRoom();
    if (!room.players.has(socket.id)) return;

    handleHoldRelease(room, socket.id, io); // don't leave them stuck "holding" if they vanish mid-round
    room.players.delete(socket.id);

    if (room.players.size === 0 && room.status !== 'lobby') {
      resetRoomToLobby(room); // nobody left to play with — don't leave the room stuck
    }

    emitRoomState(room, io);
  });
});

// Single global tick loop drives the room's live countdown broadcast.
setInterval(() => {
  tickRoom(getRoom(), io);
}, 100);

const PORT = Number(process.env.PORT) || 8080;
httpServer.listen(PORT, () => {
  console.log(`Server listening on :${PORT}`);
});
