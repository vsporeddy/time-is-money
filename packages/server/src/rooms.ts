import type { GameSettings, ItemInstance, Player, Round, RoomState, RoomStatus } from 'shared';

export interface ActiveRound {
  round: Round;
  item: ItemInstance; // full instance including trueValue — server-only until round_end
  holdStartedAt: Map<string, number>; // playerId -> epoch ms, present only while currently holding
  hasAnyoneHeld: boolean;
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
  noBidTimeoutMs: 6_000,
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

export function toRoomState(r: Room): RoomState {
  return {
    status: r.status,
    players: [...r.players.values()],
    settings: r.settings,
    currentRoundIndex: r.currentRoundIndex,
  };
}
