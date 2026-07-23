import { io, Socket } from 'socket.io-client';
import type { ClientToServerEvents, ServerToClientEvents } from 'shared';

const SERVER_URL = import.meta.env.VITE_SERVER_URL || 'http://localhost:8080';

export const socket: Socket<ServerToClientEvents, ClientToServerEvents> = io(SERVER_URL, {
  autoConnect: false,
});
