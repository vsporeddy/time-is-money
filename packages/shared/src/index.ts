// Core domain types, shared between client and server.

export * from './items.js';
export * from './traits.js';
export * from './scoring.js';

export interface Player {
  id: string;
  name: string;
  timeRemainingMs: number;
  status: 'active' | 'out_of_time';
  stash: string[]; // ItemInstance ids won
  connected: boolean;
}

export interface TimeRefundConfig {
  mode: 'flat' | 'catchup';
  amountMs: number; // flat: refund is exactly this; catchup: this is the max, scaled down as the winner's remaining time increases
}

export interface ItemTemplate {
  id: string;
  name: string;
  baseSpriteId: string;
  valueRange: [number, number];
  materials: string[];
  rarities: string[];
  effectType: 'none' | 'timeRefund';
  timeRefund?: TimeRefundConfig; // present when effectType === 'timeRefund'
  traits: string[]; // TraitDefinition ids this template's items count toward (category traits, may nest)
  scoreScaling?: 'investment' | 'bargain'; // scores based on time spent winning it, instead of/alongside trueValue
  loner?: number; // bonus applied only if this is the sole copy of this template in a player's stash
  secondPriceRebate?: boolean; // winner only "pays" the runner-up's committed time, rest refunded
}

export interface ItemInstance {
  id: string;
  templateId: string;
  material: string;
  rarity: string;
  trueValue: number;
  hiddenTraitId?: string; // secret like trueValue — stripped from round_start, revealed at round_end
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

export interface ScoreBreakdown {
  playerId: string;
  baseValue: number; // sum of trueValue after diminishing-returns-on-duplicates
  hiddenTraitBonus: number;
  scoreScalingBonus: number; // investment/bargain, from price paid
  lonerBonus: number;
  traitBonuses: { traitId: string; count: number; bonus: number }[];
  total: number;
}

export interface ServerToClientEvents {
  room_state: (state: RoomState) => void;
  round_start: (payload: { round: Round; item: Omit<ItemInstance, 'trueValue' | 'hiddenTraitId'> }) => void;
  round_tick: (payload: { players: Record<string, number>; bidders: Record<string, number> }) => void;
  reveal: (payload: { roundId: string; field: string; value: string | number }) => void;
  bidder_dropped: (payload: { roundId: string; playerId: string; committedMs: number }) => void;
  round_end: (payload: { round: Round; item: ItemInstance }) => void;
  game_over: (payload: { players: Player[]; scores: ScoreBreakdown[] }) => void;
}
