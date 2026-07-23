// Core domain types, shared between client and server.

export * from './items.js';

export interface Player {
  id: string;
  name: string;
  timeRemainingMs: number;
  status: 'active' | 'out_of_time';
  stash: string[]; // ItemInstance ids won
  connected: boolean;
}

export interface ItemTemplate {
  id: string;
  name: string;
  baseSpriteId: string;
  valueRange: [number, number];
  materials: string[];
  rarities: string[];
  effectType: 'none' | 'timeRefund'; // stretch goal hook, unused for now
}

export interface ItemInstance {
  id: string;
  templateId: string;
  material: string;
  rarity: string;
  trueValue: number;
  visual: {
    baseSpriteId: string;
    paletteId: string;
    overlayEffectIds: string[];
  };
}

export interface RoundBidder {
  isHolding: boolean;
  committedMs: number;
  droppedAt: number | null;
}

export interface Round {
  id: string;
  itemInstanceId: string;
  status: 'pending' | 'active' | 'resolved';
  bidders: Record<string, RoundBidder>;
  revealedFields: string[];
  winnerId: string | null;
}

export type RoomStatus = 'lobby' | 'in_round' | 'round_reveal' | 'game_over';

export interface GameSettings {
  startingTimeMs: number;
  refundOnFold: boolean;
  pendingDurationMs: number; // "get ready" window before hold buttons activate
  noBidTimeoutMs: number; // round ends with no winner if nobody holds within this window
  maxRoundDurationMs: number; // failsafe cutoff if holders never release
  interRoundDelayMs: number; // pause between round end and the next round starting
}

export interface RoomState {
  code: string;
  status: RoomStatus;
  players: Player[];
  settings: GameSettings;
  currentRoundIndex: number;
}

// --- Socket event contract ---
// Only join_room / room_state are implemented server-side so far (lobby proof).
// The round-related events are defined here now so client and server never
// drift on shape once round logic lands.

export interface ClientToServerEvents {
  join_room: (
    payload: { roomCode: string; playerName: string },
    ack: (res: { ok: true; playerId: string } | { ok: false; error: string }) => void
  ) => void;
  start_game: () => void;
  hold_start: () => void;
  hold_release: () => void;
}

export interface ServerToClientEvents {
  room_state: (state: RoomState) => void;
  round_start: (payload: { round: Round; item: Omit<ItemInstance, 'trueValue'> }) => void;
  round_tick: (payload: { players: Record<string, number>; bidders: Record<string, number> }) => void;
  reveal: (payload: { roundId: string; field: string; value: string | number }) => void;
  bidder_dropped: (payload: { roundId: string; playerId: string; committedMs: number }) => void;
  round_end: (payload: { round: Round; item: ItemInstance }) => void;
  game_over: (payload: { players: Player[] }) => void;
}
