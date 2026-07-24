// Core domain types, shared between client and server.

export * from './items.js';
export * from './traits.js';
export * from './scoring.js';
export * from './portraits.js';

export interface Player {
  id: string;
  name: string;
  timeRemainingMs: number;
  status: 'active' | 'out_of_time';
  stash: string[]; // ItemInstance ids won
  connected: boolean;
  portraitIndex: number;
  isObserver: boolean; // joined while a game was already in progress — watches, never bids
  isBot: boolean;
}

// Lobby-only cap on how many bots can be added to the room.
export const MAX_BOTS = 3;

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
  scoreScaling?: 'bargain'; // template-specific score effect
}

export interface ItemInstance {
  id: string;
  templateId: string;
  material: string;
  specialModifier?: 'Cursed' | 'Blessed'; // rolls independently of the base material
  loner?: boolean; // 5% independent roll; scores only when it is the sole Loner owned
  investment?: boolean; // 5% independent roll; scores from time spent bidding
  fairTrade?: boolean; // 5% independent roll; winner pays runner-up time on contested lots
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
  // The initial opt-in deadline. Bidders do not spend time until it closes.
  initialBidDeadlineAt: number | null;
  bidWindowOpen: boolean;
  // Set once the opt-in window closes and every holder starts spending simultaneously.
  spendingStartedAt: number | null;
  bidders: Record<string, RoundBidder>;
  revealedFields: string[];
  winnerId: string | null;
  soleBidder: boolean;
}

export type RoomStatus = 'lobby' | 'in_round' | 'round_reveal' | 'game_over';

export interface GameSettings {
  startingTimeMs: number;
  refundOnFold: boolean;
  pendingDurationMs: number; // "get ready" window before hold buttons activate
  noBidTimeoutMs: number; // opt-in window before time begins draining
  maxRoundDurationMs: number; // failsafe cutoff if holders never release
  interRoundDelayMs: number; // pause between round end and the next round starting
  maxRounds: number | null; // null means unlimited rounds
}

export interface RoomState {
  status: RoomStatus;
  players: Player[];
  knownItems: ItemInstance[]; // every item already won, for inventory backfill on join
  itemPrices: Record<string, number>; // revealed winning time per item, used for score effects
  settings: GameSettings;
  currentRoundIndex: number;
}

export interface ChatMessage {
  id: string;
  name: string;
  text: string;
  ts: number;
}

// --- Socket event contract ---
// A single global room — no room codes. Everyone who joins is in the same game.

export interface ClientToServerEvents {
  join_room: (
    payload: { playerName: string },
    ack: (res: { ok: true; playerId: string } | { ok: false; error: string }) => void
  ) => void;
  start_game: () => void;
  add_bot: () => void;
  hold_start: () => void;
  hold_release: () => void;
  set_round_limit: (payload: { maxRounds: number }) => void;
  restart_game: () => void;
  reset_game: () => void; // dev-only escape hatch — works from any state, remove before shipping
  send_chat: (payload: { name: string; text: string }) => void;
}

export interface ScoreBreakdown {
  playerId: string;
  baseValue: number; // sum of trueValue after diminishing-returns-on-duplicates
  hiddenTraitBonus: number;
  scoreScalingBonus: number; // investment/bargain, from price paid
  lonerBonus: number;
  traitBonuses: { traitId: string; count: number; bonus: number; multiplier?: number }[];
  total: number;
}

export interface ServerToClientEvents {
  room_state: (state: RoomState) => void;
  round_start: (payload: { round: Round; item: Omit<ItemInstance, 'trueValue' | 'hiddenTraitId'> }) => void;
  bid_window_closed: (payload: { roundId: string; spendingStartedAt: number }) => void;
  bidder_cancelled: (payload: { roundId: string; playerId: string }) => void;
  round_tick: (payload: { players: Record<string, number>; bidders: Record<string, number>; holding: string[] }) => void;
  reveal: (payload: { roundId: string; field: string; value: string | number }) => void;
  bidder_dropped: (payload: { roundId: string; playerId: string; committedMs: number }) => void;
  round_end: (payload: { round: Round; item: ItemInstance }) => void;
  game_over: (payload: { players: Player[]; scores: ScoreBreakdown[] }) => void;
  chat_history: (messages: ChatMessage[]) => void;
  chat_message: (message: ChatMessage) => void;
}
