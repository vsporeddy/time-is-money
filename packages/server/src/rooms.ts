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
  lotPool: ItemInstance[]; // this game's fixed pool, rolled once at start_game
  auctionOrder: string[]; // lotPool item ids, shuffled; only the first roundsToPlay are ever auctioned
  roundsToPlay: number; // how many lotPool items will actually go up this game
  hiddenPoolItemIds: Set<string>; // 3 random lotPool ids blurred client-side until their round starts
  revealedPoolItemIds: Set<string>; // lotPool ids whose round has already started
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
  lotPool: [],
  auctionOrder: [],
  roundsToPlay: 0,
  hiddenPoolItemIds: new Set(),
  revealedPoolItemIds: new Set(),
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
  const hasMagnifyingGlass = ownsItemTemplate(r, viewerId, 'magnifying-glass');

  return {
    status: r.status,
    players: [...r.players.values()].map((player) =>
      player.id === viewerId || ownsItemTemplate(r, viewerId, 'spyglass') ? player : { ...player, timeRemainingMs: 0 }
    ),
    knownItems: [...r.wonItems.values()],
    itemPrices: Object.fromEntries(r.itemPricePaidMs),
    settings: r.settings,
    currentRoundIndex: r.currentRoundIndex,
    lotPool: r.lotPool.map((item) => {
      const auctioned = r.revealedPoolItemIds.has(item.id);
      const hidden = !hasMagnifyingGlass && !auctioned && r.hiddenPoolItemIds.has(item.id);
      const auctionIndex = r.auctionOrder.indexOf(item.id);
      return {
        id: item.id,
        templateId: item.templateId,
        status: auctioned ? 'auctioned' : hidden ? 'hidden' : 'upcoming',
        // Magnifying Glass: reveal the whole schedule, not just this lot's modifiers.
        saleRound: hasMagnifyingGlass && auctionIndex !== -1 ? auctionIndex + 1 : undefined,
      };
    }),
  };
}

export function emitRoomState(room: Room, io: Server<ClientToServerEvents, ServerToClientEvents>) {
  for (const socketId of io.sockets.sockets.keys()) {
    io.to(socketId).emit('room_state', toRoomState(room, socketId));
  }
}
