import type { ItemInstance, Player } from 'shared';
import { computeScores, getClassDefinition, getTemplate, MAX_BOTS, pickAvailableClassId } from 'shared';
import type { ActiveRound, IO, Room } from './rooms.js';

type HoldFn = (room: Room, playerId: string, io: IO) => void;
type WeaponFn = (
  room: Room,
  io: IO,
  playerId: string,
  itemId: string,
  targetPlayerId?: string,
  targetItemId?: string
) => { ok: true } | { ok: false; error: string };

const BOT_NAMES = [
  'Chowder', 'Zalteo', 'Roffles', 'Spatika', 'Paperlisk',
  'Silverwing', 'Misder', 'Asura', 'Iron Urn', 'Phantah',
  'Doncha', 'Strawberry', 'Sapphice', 'Quasar', 'Chewpin',
  'TimmahC', 'Oxray', 'Audacity', 'BC Guy', 'Learnt',
];

function pickBotName(room: Room): string {
  const taken = new Set([...room.players.values()].map((player) => player.name.toLowerCase()));
  const available = BOT_NAMES.filter((name) => !taken.has(name.toLowerCase()));
  const pool = available.length > 0 ? available : BOT_NAMES;
  return pool[Math.floor(Math.random() * pool.length)];
}

export function addBot(room: Room): Player | null {
  if (room.status !== 'lobby') return null;

  const botCount = [...room.players.values()].filter((player) => player.isBot).length;
  if (botCount >= MAX_BOTS) return null;

  const classId = pickAvailableClassId([...room.players.values()].map((player) => player.classId));
  if (!classId) return null;

  room.botCounter += 1;
  const id = `bot-${room.botCounter}`;
  const bot: Player = {
    id,
    name: pickBotName(room),
    timeRemainingMs: room.settings.startingTimeMs,
    status: 'active',
    stash: [],
    connected: true,
    portraitIndex: getClassDefinition(classId)!.portraitIndex,
    classId,
    winStreak: 0,
    isObserver: false,
    isBot: true,
  };
  room.players.set(id, bot);
  return bot;
}

export function removeBot(room: Room): boolean {
  if (room.status !== 'lobby') return false;
  const bots = [...room.players.entries()].filter(([, player]) => player.isBot);
  if (bots.length === 0) return false;
  room.players.delete(bots[bots.length - 1][0]);
  return true;
}

interface BotPersonality {
  name: 'aggressive' | 'collector' | 'conservative' | 'disruptor' | 'opportunist';
  aggression: number;
  reserveFactor: number;
  // Minimum interest in a lot before this bot will opt in, as a fraction of
  // what it expects an average lot to be worth to it. Relative rather than an
  // absolute point count so rebalancing item values doesn't mistune entry.
  entryThresholdRatio: number;
  // How this bot reacts to a crowded lot. Positive escalates (chest-beating);
  // negative shades down, which is the all-pay-rational read — every extra
  // rival buys a lower chance of the lot for the same spent time.
  competitionBias: number;
  weaponChance: number;
}

const BOT_PERSONALITIES: BotPersonality[] = [
  { name: 'aggressive', aggression: 1.3, reserveFactor: 1.45, entryThresholdRatio: 0.2, competitionBias: 0.08, weaponChance: 0.8 },
  { name: 'collector', aggression: 1.08, reserveFactor: 1.25, entryThresholdRatio: 0.4, competitionBias: 0, weaponChance: 0.55 },
  { name: 'conservative', aggression: 0.78, reserveFactor: 0.85, entryThresholdRatio: 0.8, competitionBias: -0.1, weaponChance: 0.35 },
  { name: 'disruptor', aggression: 1, reserveFactor: 1.05, entryThresholdRatio: 0.5, competitionBias: 0.08, weaponChance: 0.95 },
  { name: 'opportunist', aggression: 0.9, reserveFactor: 1.15, entryThresholdRatio: 0.3, competitionBias: -0.06, weaponChance: 0.5 },
];

// Per-room, per-bot state that outlives a single round. Kept module-private in
// a WeakMap so Room stays a pure data record and a reaped room takes its bot
// memory with it.
interface BotRoundNerve {
  roundId: string;
  multiplier: number; // this round's frozen nerve roll, applied to every reservation re-read
  secondWinds: number; // times it has talked itself into staying past the target
}

interface BotMemory {
  lotScores: Map<string, { sum: number; count: number }>; // botId -> running marginal-score stats
  nerve: Map<string, BotRoundNerve>; // botId -> current-round nerve state
}

const BOT_MEMORY = new WeakMap<Room, BotMemory>();

function memoryFor(room: Room): BotMemory {
  let memory = BOT_MEMORY.get(room);
  if (!memory) {
    memory = { lotScores: new Map(), nerve: new Map() };
    BOT_MEMORY.set(room, memory);
  }
  return memory;
}

const EXPECTED_LOT_PRIOR = 10; // points; a plausible mid lot before any evidence
const EXPECTED_LOT_PRIOR_WEIGHT = 3;

// What this bot expects an average lot to be worth to it, in score points.
// Prior-seeded so the first lot of a game doesn't set the whole exchange rate.
function expectedLotValue(room: Room, bot: Player): number {
  const stats = memoryFor(room).lotScores.get(bot.id) ?? { sum: 0, count: 0 };
  return (
    (EXPECTED_LOT_PRIOR * EXPECTED_LOT_PRIOR_WEIGHT + stats.sum) /
    (EXPECTED_LOT_PRIOR_WEIGHT + stats.count)
  );
}

// Exactly one sample per bot per lot — including lots it declines, which are
// just as much evidence about this game's item pool as the ones it bids on.
function recordLotObservation(room: Room, bot: Player, marginalScore: number) {
  const stats = memoryFor(room).lotScores;
  const current = stats.get(bot.id) ?? { sum: 0, count: 0 };
  stats.set(bot.id, { sum: current.sum + marginalScore, count: current.count + 1 });
}

// Box-Muller. Only the noise paths use it; every deterministic decision still
// goes through lotTasteMultiplier.
function gaussian(): number {
  const u = Math.max(Number.EPSILON, Math.random());
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * Math.random());
}

const MAIN_TRAIT_IDS = new Set(['armor', 'trinket', 'text', 'musical', 'aquatic']);

function personalityFor(player: Player): BotPersonality {
  let hash = 0;
  for (const char of player.id) hash = (hash * 31 + char.charCodeAt(0)) >>> 0;
  return BOT_PERSONALITIES[hash % BOT_PERSONALITIES.length];
}

function focusTraitForBot(room: Room, bot: Player): string | undefined {
  if (room.selectedMainTraits.length === 0) return undefined;
  const bots = [...room.players.values()].filter((player) => player.isBot);
  const botIndex = bots.findIndex((player) => player.id === bot.id);
  return botIndex >= 0 ? room.selectedMainTraits[botIndex % room.selectedMainTraits.length] : undefined;
}

// A deterministic per-bot, per-lot preference keeps bot decisions varied
// without making them flip-flop during each 250ms bidding re-evaluation.
function lotTasteMultiplier(room: Room, bot: Player, item: ItemInstance): number {
  const key = `${bot.id}:${room.activeRound?.round.id ?? ''}:${item.templateId}`;
  let hash = 2166136261;
  for (const character of key) {
    hash ^= character.charCodeAt(0);
    hash = Math.imul(hash, 16777619) >>> 0;
  }

  const preference = 0.55 + ((hash % 1_000) / 1_000) * 0.9; // 0.55–1.45
  const isWhimBid = ((hash >>> 10) % 100) < 15;
  return preference * (isWhimBid ? 1.35 : 1);
}

// Construct exactly the version of the lot this bot is entitled to know.
// Prospectors see modifiers immediately; Appraisers see the hidden find.
function botVisibleItem(room: Room, player: Player): ItemInstance | undefined {
  const ar = room.activeRound;
  if (!ar) return undefined;
  const knowsModifiers = player.classId === 'prospector';
  const revealed = new Set(ar.round.revealedFields);
  return {
    ...ar.item,
    material: knowsModifiers || revealed.has('material') ? ar.item.material : 'Used',
    rarity: knowsModifiers || revealed.has('rarity') ? ar.item.rarity : 'Common',
    specialModifier: knowsModifiers || revealed.has('specialModifier') ? ar.item.specialModifier : undefined,
    hiddenTraitId: player.classId === 'appraiser' ? ar.item.hiddenTraitId : undefined,
  };
}

// assumedPriceMs is what the bot supposes it would pay for the candidate.
// Investment and Bargain items score off the price paid (scoring.ts), so
// leaving it at zero would have bots max out every Bargain bonus and value
// every Investment upside at nothing.
function scoreForPlayer(
  room: Room,
  player: Player,
  candidate?: ItemInstance,
  assumedPriceMs = 0
): number {
  const wonItems = new Map(room.wonItems);
  const pricePaid = new Map(room.itemPricePaidMs);
  const scoredPlayer = candidate ? { ...player, stash: [...player.stash, candidate.id] } : player;
  if (candidate) {
    wonItems.set(candidate.id, candidate);
    pricePaid.set(candidate.id, assumedPriceMs);
  }
  return computeScores([scoredPlayer], wonItems, pricePaid)[0]?.total ?? 0;
}

function marginalItemScore(room: Room, player: Player, assumedPriceMs = 0): number {
  const candidate = botVisibleItem(room, player);
  if (!candidate) return 0;

  let marginal =
    scoreForPlayer(room, player, candidate, assumedPriceMs) - scoreForPlayer(room, player);
  const template = getTemplate(candidate.templateId);
  const personality = personalityFor(player);
  const existingTemplates = player.stash
    .map((itemId) => room.wonItems.get(itemId))
    .map((item) => item ? getTemplate(item.templateId) : undefined)
    .filter((itemTemplate) => itemTemplate !== undefined);

  if (
    personality.name === 'collector' &&
    template?.traits.some((trait) => existingTemplates.some((owned) => owned.traits.includes(trait)))
  ) marginal *= 1.2;

  // Each bot owns one of this game's three main attribute lanes. Other main
  // families are deliberately unattractive to it, while Curios and Weapons
  // remain neutral options shared by every specialist.
  const focusTrait = focusTraitForBot(room, player);
  const itemMainTraits = template?.traits.filter((trait) => MAIN_TRAIT_IDS.has(trait)) ?? [];
  if (focusTrait && itemMainTraits.length > 0) {
    marginal *= itemMainTraits.includes(focusTrait) ? 1.4 : 0.5;
  }

  if (personality.name === 'opportunist' && candidate.trueValue <= 20) marginal *= 1.2;
  if (player.classId === 'investor') marginal *= 0.82;
  if (player.classId === 'auctioneer') marginal *= 1.1;
  if (player.classId === 'insurer') marginal *= 1.08;
  if (player.classId === 'gambler' && player.winStreak > 0) {
    marginal *= 1 + Math.min(0.2, player.winStreak * 0.05);
  }

  return Math.max(0, marginal * lotTasteMultiplier(room, player, candidate));
}

const ABSOLUTE_RESERVE_CAP_MS = 18_000;
const SELF_ELIMINATION_GUARD_MS = 150;

// One lot's fair share of the clock this bot has left.
function sustainablePerLot(room: Room, player: Player): number {
  const remainingLots = Math.max(1, room.roundsToPlay - room.currentRoundIndex);
  return player.timeRemainingMs / remainingLots;
}

function competitionFactor(room: Room, player: Player): number {
  const activeCompetitors = room.activeRound
    ? Object.values(room.activeRound.round.bidders).filter((bidder) => bidder.isHolding).length
    : 1;
  const rivals = Math.max(0, activeCompetitors - 1);
  return Math.min(1.25, Math.max(0.6, 1 + personalityFor(player).competitionBias * rivals));
}

// How long this bot is willing to hold, derived rather than tuned: the budget
// unit is one lot's fair share of its remaining clock, and the value unit is
// what it expects an average lot to be worth. A lot worth twice the average is
// worth twice the fair share. That makes the metric scale-free — doubling
// startingTimeMs or halving the round count re-tunes every bot automatically,
// where the old fixed ms-per-point rate did not.
// nerveMultiplier is this round's noise (see scheduleBotReleases). It is
// applied inside this function rather than to its result so the safety caps
// stay inviolable — an emboldened bot may overrun its soft per-lot budget, but
// never the absolute cap and never its own clock.
function reservationMs(room: Room, player: Player, assumedPriceMs = 0, nerveMultiplier = 1): number {
  const personality = personalityFor(player);
  const value = marginalItemScore(room, player, assumedPriceMs);
  if (value <= 0) return 0;

  const perLot = sustainablePerLot(room, player);
  const msPerPoint = perLot / Math.max(1, expectedLotValue(room, player));

  const remainingLots = Math.max(1, room.roundsToPlay - room.currentRoundIndex);
  const progress = 1 - remainingLots / Math.max(1, room.roundsToPlay);
  const lateGameFactor = 1 + progress * 0.35; // spend freer as the game runs out

  const desired =
    value * msPerPoint * personality.aggression * lateGameFactor * competitionFactor(room, player);

  // Soft ceiling so a single whale lot can't eat a whole clock. Nerve is
  // allowed to push past it — that's the whole point of a bot that gets
  // carried away — but not past the two hard caps below.
  const budgetCap = Math.max(1_000, perLot * personality.reserveFactor * lateGameFactor);
  const willing = Math.min(desired, budgetCap) * nerveMultiplier;

  // Hard: the absolute cap, and enough left on the clock that a bot can never
  // bid itself out of the game. timeRemainingMs isn't debited until release,
  // so it's directly comparable to the elapsed hold this bounds.
  return Math.max(
    0,
    Math.min(willing, ABSOLUTE_RESERVE_CAP_MS, player.timeRemainingMs - SELF_ELIMINATION_GUARD_MS)
  );
}

const MIN_ENTRY_DELAY_MS = 200;
const ENTRY_DELAY_SAFETY_MARGIN_MS = 150;
const SOLE_BIDDER_PRICE_MS = 5_000;

// Nerve: the round-to-round inconsistency that keeps two games from playing
// the same. Sampled once per bot per round and then held to, rather than
// re-rolled each poll — re-rolling a threshold every tick makes the exit the
// minimum of ~40 draws, which is both narrower and systematically earlier than
// the spread it looks like.
const NERVE_SIGMA = 0.25; // log-normal: ~±28% one-sigma, with a fat "won't let go" tail
const FLINCH_RATE_PER_SEC = 0.02; // hazard of losing your nerve mid-war
const FLINCH_MIN_PROGRESS = 0.4; // no flinching before this fraction of the target
const SECOND_WIND_CHANCE = 0.05; // "one more push" on reaching the target
const SECOND_WIND_MULTIPLIER = 1.3;
const MAX_SECOND_WINDS = 2;
const POLL_PRECISION_MS = 300; // switch from polling to an exact wake inside this gap

// Debug surface for scripts/bot-sim.ts, which samples these distributions
// offline. Nothing in the running server reads it.
export const __botInternals = {
  reservationMs,
  marginalItemScore,
  expectedLotValue,
  recordLotObservation,
  personalityFor,
  sustainablePerLot,
  sampleNerveMultiplier: () => Math.exp(gaussian() * NERVE_SIGMA),
  constants: {
    NERVE_SIGMA,
    FLINCH_RATE_PER_SEC,
    FLINCH_MIN_PROGRESS,
    SECOND_WIND_CHANCE,
    SECOND_WIND_MULTIPLIER,
    MAX_SECOND_WINDS,
    SOLE_BIDDER_PRICE_MS,
    ABSOLUTE_RESERVE_CAP_MS,
  },
};

export function scheduleBotEntries(room: Room, io: IO, handleHoldStart: HoldFn) {
  const ar = room.activeRound;
  if (!ar) return;

  for (const player of room.players.values()) {
    if (!player.isBot || !ar.round.bidders[player.id]) continue;
    const personality = personalityFor(player);

    // Price and reservation depend on each other for Investment and Bargain
    // lots, so settle it in two passes: a neutral guess of one lot's fair
    // share, then the reservation that guess produces.
    const firstPass = reservationMs(room, player, sustainablePerLot(room, player));
    const reserve = reservationMs(room, player, firstPass);
    const marginalScore = marginalItemScore(room, player, firstPass);

    // Every bot appraises every lot, so record the observation whether or not
    // it ends up bidding — a declined lot is evidence about this game's pool.
    const expected = expectedLotValue(room, player);
    recordLotObservation(room, player, marginalScore);

    const threshold = personality.entryThresholdRatio * expected;
    const confidence = Math.min(
      0.95,
      Math.max(0.1, 0.5 + (marginalScore - threshold) / (2 * Math.max(1, expected)))
    );
    if (reserve < SOLE_BIDDER_PRICE_MS || Math.random() > confidence) continue;

    const windowMs = room.settings.noBidTimeoutMs;
    const latestDelay = Math.max(MIN_ENTRY_DELAY_MS, windowMs - ENTRY_DELAY_SAFETY_MARGIN_MS);
    const entryDelay = MIN_ENTRY_DELAY_MS + Math.random() * Math.max(0, latestDelay - MIN_ENTRY_DELAY_MS);
    setTimeout(() => {
      if (room.activeRound === ar) handleHoldStart(room, player.id, io);
    }, entryDelay);
  }
}

function rivalsStillHolding(ar: ActiveRound, playerId: string): number {
  return Object.entries(ar.round.bidders).filter(([id, bidder]) => id !== playerId && bidder.isHolding).length;
}

// Re-evaluate throughout bidding so later reveals can raise or lower a bot's
// spending limit. This uses only revealed fields unless the class grants more.
// Safe to call more than once per round: a bot already enrolled keeps its
// existing loop and its already-sampled nerve.
export function scheduleBotReleases(room: Room, io: IO, handleHoldRelease: HoldFn) {
  const ar = room.activeRound;
  if (!ar) return;
  const memory = memoryFor(room);

  for (const [playerId, bidder] of Object.entries(ar.round.bidders)) {
    const player = room.players.get(playerId);
    if (!player?.isBot || !bidder.isHolding) continue;
    if (memory.nerve.get(playerId)?.roundId === ar.round.id) continue;

    memory.nerve.set(playerId, {
      roundId: ar.round.id,
      multiplier: Math.exp(gaussian() * NERVE_SIGMA),
      secondWinds: 0,
    });

    let lastTickAt = Date.now();
    const reconsider = () => {
      if (room.activeRound !== ar) return;
      const currentBidder = ar.round.bidders[playerId];
      if (!currentBidder?.isHolding) return;
      const startedAt = ar.holdStartedAt.get(playerId);
      if (startedAt === undefined) return;
      const nerve = memory.nerve.get(playerId);
      if (nerve?.roundId !== ar.round.id) return;

      const now = Date.now();
      const dtMs = now - lastTickAt;
      lastTickAt = now;
      const elapsed = now - startedAt;

      // Assume it pays what it has spent so far. For a Bargain lot that means
      // the bonus decays as the hold runs on, so the bot's own reservation
      // falls in real time and it lets go rather than paying away the very
      // bonus it wanted.
      const target = reservationMs(
        room,
        player,
        elapsed,
        nerve.multiplier * Math.pow(SECOND_WIND_MULTIPLIER, nerve.secondWinds)
      );

      if (elapsed >= target) {
        if (nerve.secondWinds < MAX_SECOND_WINDS && Math.random() < SECOND_WIND_CHANCE) {
          nerve.secondWinds += 1; // talked itself into one more push
        } else {
          handleHoldRelease(room, playerId, io);
          return;
        }
      } else if (elapsed > target * FLINCH_MIN_PROGRESS && rivalsStillHolding(ar, playerId) > 0) {
        // Rate-based, not per-tick, so the poll interval can change without
        // silently changing how often bots bail.
        const flinchChance = 1 - Math.exp(-FLINCH_RATE_PER_SEC * (dtMs / 1000));
        if (Math.random() < flinchChance) {
          handleHoldRelease(room, playerId, io);
          return;
        }
      }

      // Polling at 250–500ms would blunt the target by up to half a second,
      // which is a lot of a short hold — wake exactly on it when it's close.
      const remaining = target - (Date.now() - startedAt);
      const delay = remaining < POLL_PRECISION_MS ? Math.max(50, remaining) : 250 + Math.random() * 250;
      setTimeout(reconsider, delay);
    };
    setTimeout(reconsider, 250 + Math.random() * 350);
  }
}

function strongestOpponentItem(room: Room, bot: Player): { playerId: string; itemId: string } | undefined {
  let best: { playerId: string; itemId: string; value: number } | undefined;
  for (const player of room.players.values()) {
    if (player.id === bot.id || player.isObserver) continue;
    for (const itemId of player.stash) {
      const item = room.wonItems.get(itemId);
      if (!item) continue;
      if (!best || item.trueValue > best.value) best = { playerId: player.id, itemId, value: item.trueValue };
    }
  }
  return best;
}

function richestOpponent(room: Room, bot: Player): Player | undefined {
  return [...room.players.values()]
    .filter((player) => player.id !== bot.id && !player.isObserver && player.timeRemainingMs > 0)
    .sort((a, b) => b.timeRemainingMs - a.timeRemainingMs)[0];
}

export function scheduleBotWeaponUses(
  room: Room,
  io: IO,
  phase: 'preBid' | 'bidding',
  useWeapon: WeaponFn
) {
  const ar = room.activeRound;
  if (!ar) return;

  for (const bot of room.players.values()) {
    if (!bot.isBot || bot.status !== 'active') continue;
    const personality = personalityFor(bot);
    if (Math.random() > personality.weaponChance) continue;

    const weapons = bot.stash
      .map((itemId) => ({ itemId, item: room.wonItems.get(itemId) }))
      .map(({ itemId, item }) => ({ itemId, item, template: item ? getTemplate(item.templateId) : undefined }))
      .filter(({ item, template }) =>
        Boolean(
          item &&
          !item.usedActiveEffect &&
          template?.weapon &&
          template.effectType !== 'copyItem' &&
          (template.weapon.phase === phase || (phase === 'preBid' && template.weapon.phase === 'anytime'))
        )
      );

    // Appraise the lot at a neutral assumed price, the same guess entry uses,
    // so a Bargain lot isn't scored as if it were free.
    const assumedPrice = sustainablePerLot(room, bot);
    const choice = weapons.find(({ template }) => {
      if (template?.effectType === 'destroyLot') return marginalItemScore(room, bot, assumedPrice) < 7;
      if (template?.effectType === 'transformLot') return marginalItemScore(room, bot, assumedPrice) < 10;
      if (template?.effectType === 'forceWithdraw') {
        return Object.entries(ar.round.bidders).some(([id, bidder]) => id !== bot.id && bidder.isHolding);
      }
      return true;
    });
    if (!choice?.template) continue;

    let targetPlayerId: string | undefined;
    let targetItemId: string | undefined;
    if (choice.template.effectType === 'destroyItem') {
      const target = strongestOpponentItem(room, bot);
      targetPlayerId = target?.playerId;
      targetItemId = target?.itemId;
      if (!targetPlayerId || !targetItemId) continue;
    } else if (choice.template.weapon?.target === 'one') {
      const target = choice.template.effectType === 'forceWithdraw'
        ? [...room.players.values()].find((player) =>
          player.id !== bot.id && ar.round.bidders[player.id]?.isHolding
        )
        : richestOpponent(room, bot);
      if (!target) continue;
      targetPlayerId = target.id;
    }

    setTimeout(() => {
      if (room.activeRound !== ar) return;
      useWeapon(room, io, bot.id, choice.itemId, targetPlayerId, targetItemId);
    }, 250 + Math.random() * 650);
  }
}
