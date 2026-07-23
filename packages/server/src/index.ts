import express from 'express';
import { createServer } from 'node:http';
import { Server } from 'socket.io';
import type { ClientToServerEvents, Player, ServerToClientEvents } from 'shared';
import { randomPortraitIndex } from 'shared';
import { getRoom, toRoomState } from './rooms.js';
import { handleHoldRelease, handleHoldStart, restartGame, startGame, tickRoom } from './round.js';

const app = express();
const httpServer = createServer(app);

const io = new Server<ClientToServerEvents, ServerToClientEvents>(httpServer, {
  cors: { origin: '*' },
});

app.get('/health', (_req, res) => {
  res.send('ok');
});

io.on('connection', (socket) => {
  socket.on('join_room', ({ playerName }, ack) => {
    const name = playerName.trim().slice(0, 20);

    if (!name) {
      ack({ ok: false, error: 'Name is required.' });
      return;
    }

    const room = getRoom();
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

    ack({ ok: true, playerId: player.id });
    io.emit('room_state', toRoomState(room));
  });

  socket.on('start_game', () => {
    startGame(getRoom(), io);
  });

  socket.on('hold_start', () => {
    handleHoldStart(getRoom(), socket.id, io);
  });

  socket.on('hold_release', () => {
    handleHoldRelease(getRoom(), socket.id, io);
  });

  socket.on('restart_game', () => {
    restartGame(getRoom(), io);
  });

  socket.on('disconnect', () => {
    const room = getRoom();
    if (!room.players.has(socket.id)) return;

    handleHoldRelease(room, socket.id, io); // don't leave them stuck "holding" if they vanish mid-round
    room.players.delete(socket.id);
    io.emit('room_state', toRoomState(room));
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
