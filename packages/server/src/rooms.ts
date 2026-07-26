import type { DefaultEventsMap, Server, Socket } from 'socket.io';
import type { ChatMessage, ClientToServerEvents, GameSettings, ItemInstance, Player, Round, RoomState, RoomStatus, ServerToClientEvents } from 'shared';

// Which room a socket belongs to. Set once by join_room; every other handler
// resolves its room from here rather than taking a code in the payload.
export interface SocketData {
  roomCode?: string;
}

// Declared here (a leaf module) so index/round/bots all share one shape — a
// mismatched generic list makes `io` silently unassignable across files.
export type IO = Server<ClientToServerEvents, ServerToClientEvents, DefaultEventsMap, SocketData>;
export type AppSocket = Socket<ClientToServerEvents, ServerToClientEvents, DefaultEventsMap, SocketData>;

// Game-jam tuning flag: set to false to restore the original unlimited game.
const ROUND_LIMIT_ENABLED = true;
const ROUND_LIMIT = 15;

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
  code: string; // the share code; also the socket.io room name every member joins
  hostId: string | null; // the only player allowed to start/configure the game; null while empty
  createdAt: number;
  emptySince: number | null; // set when the last human leaves; the reaper deletes the room once this ages out
  // Counters that used to be module-level globals — one game per room now.
  roundCounter: number;
  botCounter: number;
  chat: ChatMessage[];
  chatCounter: number;
  status: RoomStatus;
  players: Map<string, Player>;
  settings: GameSettings;
  currentRoundIndex: number;
  activeRound: ActiveRound | null;
  lotPool: ItemInstance[]; // this game's fixed pool, rolled once at start_game
  auctionOrder: string[]; // lotPool item ids, shuffled; only the first roundsToPlay are ever auctioned
  roundsToPlay: number; // how many lotPool items will actually go up this game
  selectedMainTraits: string[]; // the three main attribute families bots specialize in this game
  hiddenPoolItemIds: Set<string>; // 3 random lotPool ids blurred client-side until their round starts
  revealedPoolItemIds: Set<string>; // lotPool ids whose round has already started
  wonItems: Map<string, ItemInstance>; // itemId -> instance, for end-game scoring lookups
  itemPricePaidMs: Map<string, number>; // itemId -> net time the winner actually paid (after any rebate)
}

const DEFAULT_SETTINGS: GameSettings = {
  startingTimeMs: 60_000,
  refundOnFold: false,
  pendingDurationMs: 3_000,
  noBidTimeoutMs: 4_000,
  maxRoundDurationMs: 60_000,
  interRoundDelayMs: 4_000,
  maxRounds: ROUND_LIMIT_ENABLED ? ROUND_LIMIT : null,
  openBidding: false,
};

// Every room owns its own settings object — sharing one would make any host's
// round-limit change apply to every lobby on the server.
export function createRoomObject(code: string): Room {
  return {
    code,
    hostId: null,
    createdAt: Date.now(),
    emptySince: Date.now(),
    roundCounter: 0,
    botCounter: 0,
    chat: [],
    chatCounter: 0,
    status: 'lobby',
    players: new Map(),
    settings: { ...DEFAULT_SETTINGS },
    currentRoundIndex: -1,
    activeRound: null,
    lotPool: [],
    auctionOrder: [],
    roundsToPlay: 0,
    selectedMainTraits: [],
    hiddenPoolItemIds: new Set(),
    revealedPoolItemIds: new Set(),
    wonItems: new Map(),
    itemPricePaidMs: new Map(),
  };
}

export function isHost(r: Room, playerId: string | undefined): boolean {
  return r.hostId !== null && r.hostId === playerId;
}

// Human player ids are socket ids, so this doubles as the list of sockets to
// fan personalized state out to. Bots have ids like `bot-1` and no socket.
export function humanPlayerIds(r: Room): string[] {
  return [...r.players.values()].filter((p) => !p.isBot).map((p) => p.id);
}

export function humanCount(r: Room): number {
  let count = 0;
  for (const player of r.players.values()) if (!player.isBot) count += 1;
  return count;
}

// True if the given player currently holds an item of the given template —
// used to gate passive item effects (e.g. Spyglass).
export function ownsItemTemplate(r: Room, playerId: string | undefined, templateId: string): boolean {
  if (!playerId) return false;
  const player = r.players.get(playerId);
  if (!player) return false;
  return player.stash.some((itemId) => r.wonItems.get(itemId)?.templateId === templateId);
}

// True if the given player is currently playing the given class — used to
// gate passive class abilities (e.g. Merchant, Spy).
export function playerHasClass(r: Room, playerId: string | undefined, classId: string): boolean {
  if (!playerId) return false;
  return r.players.get(playerId)?.classId === classId;
}

export function toRoomState(r: Room, viewerId?: string): RoomState {
  const isSpy = playerHasClass(r, viewerId, 'spy');
  const isMerchant = playerHasClass(r, viewerId, 'merchant');

  return {
    code: r.code,
    hostId: r.hostId,
    status: r.status,
    players: [...r.players.values()].map((player) =>
      player.id === viewerId || r.settings.openBidding || ownsItemTemplate(r, viewerId, 'spyglass')
        ? player
        : { ...player, timeRemainingMs: 0 }
    ),
    knownItems: [...r.wonItems.values()],
    itemPrices: Object.fromEntries(r.itemPricePaidMs),
    settings: r.settings,
    currentRoundIndex: r.currentRoundIndex,
    lotPool: r.lotPool.map((item) => {
      const auctioned = r.revealedPoolItemIds.has(item.id);
      const hidden = !isSpy && !auctioned && r.hiddenPoolItemIds.has(item.id);
      const auctionIndex = r.auctionOrder.indexOf(item.id);
      return {
        id: item.id,
        templateId: item.templateId,
        status: auctioned ? 'auctioned' : hidden ? 'hidden' : 'upcoming',
        // Merchant: reveal the whole schedule, not just this lot's modifiers.
        saleRound: isMerchant && auctionIndex !== -1 ? auctionIndex + 1 : undefined,
      };
    }),
  };
}

// Personalized per viewer, so this cannot be a single io.to(room.code) broadcast.
export function emitRoomState(room: Room, io: IO) {
  for (const viewerId of humanPlayerIds(room)) {
    io.to(viewerId).emit('room_state', toRoomState(room, viewerId));
  }
}
