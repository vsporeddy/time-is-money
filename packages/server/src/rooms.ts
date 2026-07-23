import type { Server } from 'socket.io';
import type { ClientToServerEvents, GameSettings, ItemInstance, Player, Round, RoomState, RoomStatus, ServerToClientEvents } from 'shared';

export interface ActiveRound {
  round: Round;
  item: ItemInstance; // full instance including trueValue — server-only until round_end
  holdStartedAt: Map<string, number>; // playerId -> epoch ms, present only while currently holding
  hasAnyoneHeld: boolean;
  bidWindowOpen: boolean; // players opt in during this window; no time is spent yet
  noBidTimer: NodeJS.Timeout | null;
  maxDurationTimer: NodeJS.Timeout | null;
  interRoundTimer: NodeJS.Timeout | null;
}

export interface Room {
  status: RoomStatus;
  players: Map<string, Player>;
  settings: GameSettings;
  currentRoundIndex: number;
  activeRound: ActiveRound | null;
  wonItems: Map<string, ItemInstance>; // itemId -> instance, for end-game scoring lookups
  itemPricePaidMs: Map<string, number>; // itemId -> net time the winner actually paid (after any rebate)
}

const DEFAULT_SETTINGS: GameSettings = {
  startingTimeMs: 60_000,
  refundOnFold: false,
  pendingDurationMs: 3_000,
  noBidTimeoutMs: 3_000,
  maxRoundDurationMs: 45_000,
  interRoundDelayMs: 4_000,
};

// Single global room — everyone who connects plays in the same game.
const room: Room = {
  status: 'lobby',
  players: new Map(),
  settings: { ...DEFAULT_SETTINGS },
  currentRoundIndex: -1,
  activeRound: null,
  wonItems: new Map(),
  itemPricePaidMs: new Map(),
};

export function getRoom(): Room {
  return room;
}

export function toRoomState(r: Room, viewerId?: string): RoomState {
  return {
    status: r.status,
    players: [...r.players.values()].map((player) =>
      player.id === viewerId ? player : { ...player, timeRemainingMs: 0 }
    ),
    knownItems: [...r.wonItems.values()],
    itemPrices: Object.fromEntries(r.itemPricePaidMs),
    settings: r.settings,
    currentRoundIndex: r.currentRoundIndex,
  };
}

export function emitRoomState(room: Room, io: Server<ClientToServerEvents, ServerToClientEvents>) {
  for (const socketId of io.sockets.sockets.keys()) {
    io.to(socketId).emit('room_state', toRoomState(room, socketId));
  }
}
