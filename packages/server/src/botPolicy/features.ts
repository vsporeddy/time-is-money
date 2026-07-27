// The one definition of the policy's observation vector.
//
// This lives in src/ rather than scripts/ deliberately: it is imported by both
// the offline trainer and bots.ts at runtime. Train/serve skew — the encoder
// drifting apart from the thing that produced the weights — is the standard way
// this class of project fails silently, and a single shared module is the whole
// defence. FEATURE_NAMES is hashed into the weights artifact so a layout change
// becomes a load-time error instead of a garbage policy.
//
// Masking discipline: every lot field must come from the caller's already-masked
// item (botVisibleItem), never from room.activeRound.item. The *Known flags
// exist because botVisibleItem substitutes 'Used'/'Common'/undefined for
// unrevealed fields (bots.ts:180-183) — without a separate flag the net cannot
// tell "this lot is Used" from "I am not allowed to know".

import type { ItemInstance, Player } from 'shared';
import { CLASS_DEFINITIONS, computeScores, getTemplate } from 'shared';
import type { Room } from '../rooms.js';

// The 7 template-tag traits. 'cursed' is deliberately absent: it is a
// materialMatch trait (traits.ts:32) counted off the rolled instance, not a tag
// on the template.
const TEMPLATE_TRAITS = ['weapon', 'armor', 'magic', 'trinket', 'text', 'musical', 'aquatic'] as const;
const MAIN_TRAITS = ['armor', 'trinket', 'text', 'musical', 'aquatic'] as const;
const EFFECT_TYPES = [
  'none', 'timeRefund', 'revealBidding', 'chest', 'key', 'refundOnLoss', 'copyItem',
  'destroyLot', 'forceEnter', 'forceWithdraw', 'destroyItem', 'transformLot', 'stealTime',
  'weaponMultiplier', 'itemValueMultiplier',
] as const;
const RARITIES = ['Common', 'Rare', 'Legendary'] as const;
const MATERIALS = ['Used', 'Damaged', 'Mint'] as const;
const HIDDEN_TRAITS = ['windfall', 'flawed', 'sleeper'] as const;
const ABSOLUTE_RESERVE_CAP_MS = 18_000; // mirrors bots.ts; used only to normalize

export interface ObsContext {
  room: Room;
  player: Player;
  visibleItem: ItemInstance; // from botVisibleItem — never room.activeRound.item
  revealed: ReadonlySet<string>; // round.revealedFields
  assumedPriceMs: number;
  heuristicWillingMs: number; // pre-cap; the residual base
  marginalScore: number;
  expectedLot: number;
  perLotMs: number;
  lotObservationCount: number;
}

function clip(value: number, lo = 0, hi = 1): number {
  return value < lo ? lo : value > hi ? hi : value;
}

// Built alongside the encoder so the two can never disagree about ordering.
const names: string[] = [];
let building = true;

function push(out: Float32Array, offset: number, name: string, value: number): number {
  if (building) names.push(name);
  out[offset] = Number.isFinite(value) ? value : 0;
  return offset + 1;
}

function pushOneHot<T extends string>(
  out: Float32Array,
  offset: number,
  prefix: string,
  options: readonly T[],
  value: T | undefined | null
): number {
  let next = offset;
  for (const option of options) {
    next = push(out, next, `${prefix}.${option}`, value === option ? 1 : 0);
  }
  return next;
}

// Scratch size while the layout is still being discovered; OBS_DIM below
// replaces it on the first call and is exact from then on.
const MAX_OBS_DIM = 256;

export function buildObservation(ctx: ObsContext, out?: Float32Array): Float32Array {
  const target = out ?? new Float32Array(names.length || MAX_OBS_DIM);
  const { room, player, visibleItem: item } = ctx;
  const template = getTemplate(item.templateId);
  const settings = room.settings;
  let o = 0;

  const actives = [...room.players.values()].filter(
    (candidate) => !candidate.isObserver && candidate.status === 'active'
  );
  const rivals = actives.filter((candidate) => candidate.id !== player.id);
  const totalTime = actives.reduce((sum, candidate) => sum + candidate.timeRemainingMs, 0);
  const meanTime = totalTime / Math.max(1, actives.length);
  const betterClocks = rivals.filter((r) => r.timeRemainingMs > player.timeRemainingMs).length;

  // --- Block A: self, 8 -------------------------------------------------------
  o = push(target, o, 'self.timeFrac', clip(player.timeRemainingMs / Math.max(1, settings.startingTimeMs), 0, 3));
  o = push(target, o, 'self.logTime', Math.log1p(player.timeRemainingMs / 1000) / 5);
  o = push(target, o, 'self.timeRank', actives.length > 1 ? betterClocks / (actives.length - 1) : 0);
  o = push(target, o, 'self.timeVsMean', clip(player.timeRemainingMs / Math.max(1, meanTime), 0, 3));
  o = push(target, o, 'self.stashSize', clip(player.stash.length / 8));
  o = push(target, o, 'self.winStreak', clip(player.winStreak / 4));
  o = push(target, o, 'self.lowClock', player.timeRemainingMs < 10_000 ? 1 : 0);
  o = push(target, o, 'self.timeShare', totalTime > 0 ? player.timeRemainingMs / totalTime : 0);

  // --- Block B: class one-hot, 10 --------------------------------------------
  o = pushOneHot(target, o, 'class', CLASS_DEFINITIONS.map((c) => c.id), player.classId);

  // --- Block C: round context, 16 --------------------------------------------
  const roundsToPlay = Math.max(1, room.roundsToPlay);
  const remainingLots = Math.max(0, room.roundsToPlay - room.currentRoundIndex);
  const holding = room.activeRound
    ? Object.values(room.activeRound.round.bidders).filter((bidder) => bidder.isHolding).length
    : 0;
  o = push(target, o, 'round.progress', clip(room.currentRoundIndex / roundsToPlay));
  o = push(target, o, 'round.remainingFrac', clip(remainingLots / roundsToPlay));
  o = push(target, o, 'round.logRemaining', Math.log1p(remainingLots) / 3);
  o = push(target, o, 'round.eligible', clip(actives.length / 10));
  o = push(target, o, 'round.rivalsHolding', clip(Math.max(0, holding - 1) / 9));
  o = push(target, o, 'round.soleRisk', rivals.length === 0 ? 1 : 0);
  for (const trait of MAIN_TRAITS) {
    o = push(target, o, `round.mainTrait.${trait}`, room.selectedMainTraits.includes(trait) ? 1 : 0);
  }
  // focusTraitForBot assigns by bot index; recomputed here rather than imported
  // to keep this module free of a bots.ts cycle.
  const bots = [...room.players.values()].filter((candidate) => candidate.isBot);
  const botIndex = bots.findIndex((candidate) => candidate.id === player.id);
  const focusTrait = botIndex >= 0 && room.selectedMainTraits.length > 0
    ? room.selectedMainTraits[botIndex % room.selectedMainTraits.length]
    : undefined;
  o = pushOneHot(target, o, 'round.focus', MAIN_TRAITS, focusTrait as typeof MAIN_TRAITS[number]);

  // --- Block D: lot, masked, 45 ----------------------------------------------
  const traits = template?.traits ?? [];
  for (const trait of TEMPLATE_TRAITS) {
    o = push(target, o, `lot.trait.${trait}`, traits.includes(trait) ? 1 : 0);
  }
  const knowsAll = player.classId === 'prospector';
  const rarityKnown = knowsAll || ctx.revealed.has('rarity');
  const materialKnown = knowsAll || ctx.revealed.has('material');
  const specialKnown = knowsAll || ctx.revealed.has('specialModifier');
  const hiddenKnown = player.classId === 'appraiser';

  o = pushOneHot(target, o, 'lot.rarity', RARITIES, rarityKnown ? (item.rarity as typeof RARITIES[number]) : undefined);
  o = push(target, o, 'lot.rarityKnown', rarityKnown ? 1 : 0);
  o = pushOneHot(target, o, 'lot.material', MATERIALS, materialKnown ? (item.material as typeof MATERIALS[number]) : undefined);
  o = push(target, o, 'lot.materialKnown', materialKnown ? 1 : 0);
  o = push(target, o, 'lot.cursed', specialKnown && item.specialModifier === 'Cursed' ? 1 : 0);
  o = push(target, o, 'lot.blessed', specialKnown && item.specialModifier === 'Blessed' ? 1 : 0);
  o = push(target, o, 'lot.noModifier', specialKnown && !item.specialModifier ? 1 : 0);
  o = push(target, o, 'lot.specialKnown', specialKnown ? 1 : 0);
  o = pushOneHot(target, o, 'lot.effect', EFFECT_TYPES, template?.effectType ?? 'none');
  o = pushOneHot(target, o, 'lot.hidden', HIDDEN_TRAITS, hiddenKnown ? (item.hiddenTraitId as typeof HIDDEN_TRAITS[number]) : undefined);
  o = push(target, o, 'lot.hiddenKnown', hiddenKnown ? 1 : 0);
  o = push(target, o, 'lot.solitaire', item.solitaire ? 1 : 0);
  o = push(target, o, 'lot.investment', item.investment ? 1 : 0);
  o = push(target, o, 'lot.fairTrade', item.fairTrade ? 1 : 0);
  o = push(target, o, 'lot.trueValue', item.trueValue / 60);
  o = push(target, o, 'lot.flatValue', template?.flatValue ? 1 : 0);
  o = push(target, o, 'lot.hasWeapon', template?.weapon ? 1 : 0);

  // --- Block E: derived scalars, 8 -------------------------------------------
  o = push(target, o, 'derived.marginalVsExpected', ctx.marginalScore / Math.max(1, ctx.expectedLot));
  o = push(target, o, 'derived.marginal', ctx.marginalScore / 30);
  o = push(target, o, 'derived.expectedLot', ctx.expectedLot / 30);
  o = push(target, o, 'derived.perLot', ctx.perLotMs / Math.max(1, settings.startingTimeMs));
  o = push(target, o, 'derived.msPerPoint', ctx.perLotMs / Math.max(1, ctx.expectedLot) / 1000);
  o = push(target, o, 'derived.willingVsCap', ctx.heuristicWillingMs / ABSOLUTE_RESERVE_CAP_MS);
  o = push(target, o, 'derived.willingVsPerLot', ctx.heuristicWillingMs / Math.max(1, ctx.perLotMs));
  o = push(target, o, 'derived.evidence', clip(ctx.lotObservationCount / 15));

  // --- Block F: synergy and opponents, 19 ------------------------------------
  const ownItems = player.stash
    .map((id) => room.wonItems.get(id))
    .filter((owned): owned is ItemInstance => Boolean(owned));
  const traitCount = (items: ItemInstance[], trait: string) =>
    items.filter((owned) => getTemplate(owned.templateId)?.traits.includes(trait)).length;

  for (const trait of TEMPLATE_TRAITS) {
    o = push(target, o, `own.trait.${trait}`, clip(traitCount(ownItems, trait) / 4));
  }
  const rivalItems = rivals.map((rival) =>
    rival.stash.map((id) => room.wonItems.get(id)).filter((owned): owned is ItemInstance => Boolean(owned))
  );
  for (const trait of TEMPLATE_TRAITS) {
    const worst = rivalItems.reduce((max, items) => Math.max(max, traitCount(items, trait)), 0);
    o = push(target, o, `rival.trait.${trait}`, clip(worst / 4));
  }

  const scored = computeScores([player, ...rivals], room.wonItems, room.itemPricePaidMs);
  const ownScore = scored[0]?.total ?? 0;
  const bestRival = scored.slice(1).reduce((max, score) => Math.max(max, score.total), 0);
  o = push(target, o, 'score.own', ownScore / 100);
  o = push(target, o, 'score.gap', (ownScore - bestRival) / 100);

  // Remaining-pool scarcity: the heuristic has no notion of "this is the last
  // armor lot", which is exactly the sort of structure a net can express.
  const remaining = room.lotPool
    .filter((candidate) => !room.wonItems.has(candidate.id))
    .map((candidate) => getTemplate(candidate.templateId))
    .filter((candidate): candidate is NonNullable<typeof candidate> => Boolean(candidate));
  const topOwnTrait = [...TEMPLATE_TRAITS]
    .map((trait) => ({ trait, count: traitCount(ownItems, trait) }))
    .sort((a, b) => b.count - a.count)[0];
  const sharingTop = topOwnTrait && topOwnTrait.count > 0
    ? remaining.filter((candidate) => candidate.traits.includes(topOwnTrait.trait)).length
    : 0;
  const sharingMains = remaining.filter((candidate) =>
    candidate.traits.some((trait) => room.selectedMainTraits.includes(trait))
  ).length;
  o = push(target, o, 'pool.sharingTopTrait', remaining.length > 0 ? sharingTop / remaining.length : 0);
  o = push(target, o, 'pool.sharingMains', remaining.length > 0 ? sharingMains / remaining.length : 0);
  o = push(
    target,
    o,
    'pool.meanBaseValue',
    remaining.length > 0
      ? remaining.reduce((sum, candidate) => sum + candidate.baseValue, 0) / remaining.length / 40
      : 0
  );

  building = false;
  return target;
}

// Discovered by running the encoder once against a throwaway context, so the
// dimension can never disagree with the code above.
export const OBS_DIM = (() => {
  const probe = new Float32Array(MAX_OBS_DIM);
  const room = {
    players: new Map(),
    settings: { startingTimeMs: 60_000 },
    activeRound: null,
    roundsToPlay: 15,
    currentRoundIndex: 0,
    selectedMainTraits: [],
    wonItems: new Map(),
    itemPricePaidMs: new Map(),
    lotPool: [],
  } as unknown as Room;
  const player = {
    id: 'probe', classId: 'prospector', stash: [], timeRemainingMs: 60_000,
    winStreak: 0, isBot: true, isObserver: false, status: 'active',
  } as unknown as Player;
  const item = {
    id: 'probe-item', templateId: 'flail', material: 'Used', rarity: 'Common',
    trueValue: 10, visual: { baseSpriteId: '0', paletteId: '0', overlayEffectIds: [] },
  } as unknown as ItemInstance;
  buildObservation(
    {
      room, player, visibleItem: item, revealed: new Set(), assumedPriceMs: 0,
      heuristicWillingMs: 0, marginalScore: 0, expectedLot: 10, perLotMs: 4_000,
      lotObservationCount: 0,
    },
    probe
  );
  return names.length;
})();

export const FEATURE_NAMES: readonly string[] = names;

// FNV-1a over the ordered feature names. Stored in the weights artifact; a
// mismatch at load time means the encoder changed since training and the
// weights are meaningless.
export function featureNamesHash(): string {
  let hash = 2166136261;
  for (const character of FEATURE_NAMES.join('|')) {
    hash ^= character.charCodeAt(0);
    hash = Math.imul(hash, 16777619) >>> 0;
  }
  return hash.toString(16).padStart(8, '0');
}
