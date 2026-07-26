import type { ItemInstance, Player } from 'shared';
import { computeScores, getClassDefinition, getTemplate, MAX_BOTS, pickAvailableClassId } from 'shared';
import type { IO, Room } from './rooms.js';

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
  entryThreshold: number;
  weaponChance: number;
}

const BOT_PERSONALITIES: BotPersonality[] = [
  { name: 'aggressive', aggression: 1.3, reserveFactor: 1.45, entryThreshold: 2, weaponChance: 0.8 },
  { name: 'collector', aggression: 1.08, reserveFactor: 1.25, entryThreshold: 4, weaponChance: 0.55 },
  { name: 'conservative', aggression: 0.78, reserveFactor: 0.85, entryThreshold: 8, weaponChance: 0.35 },
  { name: 'disruptor', aggression: 1, reserveFactor: 1.05, entryThreshold: 5, weaponChance: 0.95 },
  { name: 'opportunist', aggression: 0.9, reserveFactor: 1.15, entryThreshold: 3, weaponChance: 0.5 },
];

function personalityFor(player: Player): BotPersonality {
  let hash = 0;
  for (const char of player.id) hash = (hash * 31 + char.charCodeAt(0)) >>> 0;
  return BOT_PERSONALITIES[hash % BOT_PERSONALITIES.length];
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

function scoreForPlayer(room: Room, player: Player, candidate?: ItemInstance): number {
  const wonItems = new Map(room.wonItems);
  const scoredPlayer = candidate ? { ...player, stash: [...player.stash, candidate.id] } : player;
  if (candidate) wonItems.set(candidate.id, candidate);
  return computeScores([scoredPlayer], wonItems, room.itemPricePaidMs)[0]?.total ?? 0;
}

function marginalItemScore(room: Room, player: Player): number {
  const candidate = botVisibleItem(room, player);
  if (!candidate) return 0;

  let marginal = scoreForPlayer(room, player, candidate) - scoreForPlayer(room, player);
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
  if (personality.name === 'opportunist' && candidate.trueValue <= 20) marginal *= 1.2;
  if (player.classId === 'investor') marginal *= 0.82;
  if (player.classId === 'auctioneer') marginal *= 1.1;
  if (player.classId === 'insurer') marginal *= 1.08;
  if (player.classId === 'gambler' && player.winStreak > 0) {
    marginal *= 1 + Math.min(0.2, player.winStreak * 0.05);
  }

  return Math.max(0, marginal);
}

function reservationMs(room: Room, player: Player): number {
  const personality = personalityFor(player);
  const marginalScore = marginalItemScore(room, player);
  const remainingLots = Math.max(1, room.roundsToPlay - room.currentRoundIndex);
  const sustainablePerLot = player.timeRemainingMs / remainingLots;
  const progress = 1 - remainingLots / Math.max(1, room.roundsToPlay);
  const lateGameFactor = 1 + progress * 0.35;
  const activeCompetitors = room.activeRound
    ? Object.values(room.activeRound.round.bidders).filter((bidder) => bidder.isHolding).length
    : 1;
  const competitionFactor = 1 + Math.min(0.25, Math.max(0, activeCompetitors - 1) * 0.08);
  const desired = marginalScore * 220 * personality.aggression * lateGameFactor * competitionFactor;
  const budgetCap = Math.max(1_000, sustainablePerLot * personality.reserveFactor);
  return Math.max(0, Math.min(desired, budgetCap, 18_000, player.timeRemainingMs - 150));
}

const MIN_ENTRY_DELAY_MS = 200;
const ENTRY_DELAY_SAFETY_MARGIN_MS = 150;
const SOLE_BIDDER_PRICE_MS = 5_000;

export function scheduleBotEntries(room: Room, io: IO, handleHoldStart: HoldFn) {
  const ar = room.activeRound;
  if (!ar) return;

  for (const player of room.players.values()) {
    if (!player.isBot || !ar.round.bidders[player.id]) continue;
    const personality = personalityFor(player);
    const marginalScore = marginalItemScore(room, player);
    const reserve = reservationMs(room, player);
    const confidence = Math.min(0.95, Math.max(0.1, (marginalScore - personality.entryThreshold + 10) / 25));
    if (reserve < SOLE_BIDDER_PRICE_MS || Math.random() > confidence) continue;

    const windowMs = room.settings.noBidTimeoutMs;
    const latestDelay = Math.max(MIN_ENTRY_DELAY_MS, windowMs - ENTRY_DELAY_SAFETY_MARGIN_MS);
    const entryDelay = MIN_ENTRY_DELAY_MS + Math.random() * Math.max(0, latestDelay - MIN_ENTRY_DELAY_MS);
    setTimeout(() => {
      if (room.activeRound === ar) handleHoldStart(room, player.id, io);
    }, entryDelay);
  }
}

// Re-evaluate throughout bidding so later reveals can raise or lower a bot's
// spending limit. This uses only revealed fields unless the class grants more.
export function scheduleBotReleases(room: Room, io: IO, handleHoldRelease: HoldFn) {
  const ar = room.activeRound;
  if (!ar) return;

  for (const [playerId, bidder] of Object.entries(ar.round.bidders)) {
    const player = room.players.get(playerId);
    if (!player?.isBot || !bidder.isHolding) continue;

    const reconsider = () => {
      if (room.activeRound !== ar) return;
      const currentBidder = ar.round.bidders[playerId];
      if (!currentBidder?.isHolding) return;
      const startedAt = ar.holdStartedAt.get(playerId);
      if (startedAt === undefined) return;
      const elapsed = Date.now() - startedAt;
      const jitter = 0.9 + Math.random() * 0.2;
      if (elapsed >= reservationMs(room, player) * jitter) {
        handleHoldRelease(room, playerId, io);
        return;
      }
      setTimeout(reconsider, 250 + Math.random() * 250);
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
          (template.weapon.phase === phase || (phase === 'preBid' && template.weapon.phase === 'anytime'))
        )
      );

    const choice = weapons.find(({ template }) => {
      if (template?.effectType === 'destroyLot') return marginalItemScore(room, bot) < 7;
      if (template?.effectType === 'transformLot') return marginalItemScore(room, bot) < 10;
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
