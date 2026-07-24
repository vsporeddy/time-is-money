import type { Server } from 'socket.io';
import type { ClientToServerEvents, GameSettings, ItemInstance, Player, Round, RoomState, RoomStatus, ServerToClientEvents } from 'shared';

// Game-jam tuning flag: set to false to restore the original unlimited game.
const ROUND_LIMIT_ENABLED = true;
const ROUND_LIMIT = 10;

export interface ActiveRound {
  round: Round;
  item: ItemInstance; // full instance including trueValue — server-only until round_end
  holdStartedAt: Map<string, number>; // playerId -> epoch ms, present only while currently holding
  hasAnyoneHeld: boolean;
  bidWindowOpen: boolean; // players opt in during this window; no time is spent yet
  noBidTimer: NodeJS.Timeout | null;
  maxDurationTimer: NodeJS.Timeout | null;
  interRoundTimer: NodeJS.Timeout | null;
  modifierRevealTimers: NodeJS.Timeout[];
  allowedBidderIds: Set<string> | null; // set by Dual Daggers — enforced in handleHoldStart
}

export interface Room {
  status: RoomStatus;
  players: Map<string, Player>;
  settings: GameSettings;
  currentRoundIndex: number;
  activeRound: ActiveRound | null;
  usedItemTemplateIds: Set<string>; // templates already shown this game, including passed lots
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
  maxRounds: ROUND_LIMIT_ENABLED ? ROUND_LIMIT : null,
};

// Single global room — everyone who connects plays in the same game.
const room: Room = {
  status: 'lobby',
  players: new Map(),
  settings: { ...DEFAULT_SETTINGS },
  currentRoundIndex: -1,
  activeRound: null,
  usedItemTemplateIds: new Set(),
  wonItems: new Map(),
  itemPricePaidMs: new Map(),
};

export function getRoom(): Room {
  return room;
}

// True if the given player currently holds an item of the given template —
// used to gate passive item effects (e.g. Spyglass, Magnifying Glass).
export function ownsItemTemplate(r: Room, playerId: string | undefined, templateId: string): boolean {
  if (!playerId) return false;
  const player = r.players.get(playerId);
  if (!player) return false;
  return player.stash.some((itemId) => r.wonItems.get(itemId)?.templateId === templateId);
}

export function toRoomState(r: Room, viewerId?: string): RoomState {
  return {
    status: r.status,
    players: [...r.players.values()].map((player) =>
      player.id === viewerId || ownsItemTemplate(r, viewerId, 'spyglass') ? player : { ...player, timeRemainingMs: 0 }
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
