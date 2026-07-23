import express from 'express';
import { createServer } from 'node:http';
import { Server } from 'socket.io';
import type { ClientToServerEvents, Player, ServerToClientEvents } from 'shared';
import { randomPortraitIndex } from 'shared';
import { getOrCreateRoom, listRooms, toRoomState } from './rooms.js';
import { handleHoldRelease, handleHoldStart, startGame, tickRoom } from './round.js';

const app = express();
const httpServer = createServer(app);

const io = new Server<ClientToServerEvents, ServerToClientEvents>(httpServer, {
  cors: { origin: '*' },
});

app.get('/health', (_req, res) => {
  res.send('ok');
});

// Tracks which room a connected socket belongs to, so disconnect can clean up.
const socketRoom = new Map<string, string>();

io.on('connection', (socket) => {
  socket.on('join_room', ({ roomCode, playerName }, ack) => {
    const code = roomCode.trim().toUpperCase();
    const name = playerName.trim().slice(0, 20);

    if (!code || !name) {
      ack({ ok: false, error: 'Room code and name are required.' });
      return;
    }

    const room = getOrCreateRoom(code);
    if (room.status !== 'lobby') {
      ack({ ok: false, error: 'Game already in progress.' });
      return;
    }

    const player: Player = {
      id: socket.id,
      name,
      timeRemainingMs: room.settings.startingTimeMs,
      status: 'active',
      stash: [],
      connected: true,
      portraitIndex: randomPortraitIndex(),
    };
    room.players.set(player.id, player);
    socketRoom.set(socket.id, code);
    socket.join(code);

    ack({ ok: true, playerId: player.id });
    io.to(code).emit('room_state', toRoomState(room));
  });

  socket.on('start_game', () => {
    const code = socketRoom.get(socket.id);
    if (!code) return;
    const room = getOrCreateRoom(code);
    startGame(room, io);
  });

  socket.on('hold_start', () => {
    const code = socketRoom.get(socket.id);
    if (!code) return;
    const room = getOrCreateRoom(code);
    handleHoldStart(room, socket.id, io);
  });

  socket.on('hold_release', () => {
    const code = socketRoom.get(socket.id);
    if (!code) return;
    const room = getOrCreateRoom(code);
    handleHoldRelease(room, socket.id, io);
  });

  socket.on('disconnect', () => {
    const code = socketRoom.get(socket.id);
    if (!code) return;
    socketRoom.delete(socket.id);

    const room = getOrCreateRoom(code);
    handleHoldRelease(room, socket.id, io); // don't leave them stuck "holding" if they vanish mid-round
    room.players.delete(socket.id);
    io.to(code).emit('room_state', toRoomState(room));
  });
});

// Single global tick loop drives every room's live countdown broadcast.
setInterval(() => {
  for (const room of listRooms()) {
    tickRoom(room, io);
  }
}, 100);

const PORT = Number(process.env.PORT) || 8080;
httpServer.listen(PORT, () => {
  console.log(`Server listening on :${PORT}`);
});
