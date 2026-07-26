import type { ItemTemplate, MaskedRoundItem, Player, Round, TimeRefundConfig } from 'shared';
import { cloneItemInstance, computeScores, getTemplate, ITEM_TEMPLATES, rollItemInstanceForTemplate, shuffle } from 'shared';
import { emitRoomState, humanPlayerIds, ownsItemTemplate, playerHasClass } from './rooms.js';
import type { ActiveRound, IO, Room } from './rooms.js';
import { scheduleBotEntries, scheduleBotReleases, scheduleBotWeaponUses } from './bots.js';
import { addSystemChatMessage } from './chat.js';

const SOLE_BIDDER_PRICE_MS = 5_000;
const MODIFIER_REVEAL_INTERVAL_MS = 7_000;
const INVESTOR_INTEREST_RATE = 0.03; // Investor: % of unspent time added at the end of every round
const AUCTIONEER_REBATE_RATE = 0.1; // Auctioneer: % of the price paid rebated back on every win
const INSURER_REFUND_RATE = 0.25; // Insurer: % of committed time recovered on a lost bid
const HOURGLASS_REFUND_RATE = 0.5; // Chronomancer's Hourglass: % of committed time recovered on a lost bid
const GAMBLER_STREAK_REBATE_RATE_PER_WIN = 0.05; // Gambler: % of price rebated per consecutive win, additive
const GAMBLER_MAX_STREAK_WINS = 4; // caps the rebate scaling at a 4-win streak (20%)
const EARLY_UTILITY_TEMPLATE_IDS = new Set(['spyglass', 'chronomancers-hourglass']);
const TREASURE_CHEST_TEMPLATE_ID = 'treasure-chest';
const TREASURE_CHEST_KEY_TEMPLATE_ID = 'rusty-key';
const MAIN_TRAIT_IDS = ['armor', 'trinket', 'text', 'musical', 'aquatic'] as const;
type MainTraitId = (typeof MAIN_TRAIT_IDS)[number];

function logSystemEvent(room: Room, io: IO, text: string) {
  const message = addSystemChatMessage(room, text);
  io.to(room.code).emit('chat_message', message);
}

function logGameEvent(room: Room, io: IO, text: string) {
  const lotNumber = Math.max(1, room.currentRoundIndex + 1);
  logSystemEvent(room, io, `[Lot ${lotNumber}] ${text}`);
}

function takeRandom<T>(items: T[]): T | undefined {
  if (items.length === 0) return undefined;
  return items.splice(Math.floor(Math.random() * items.length), 1)[0];
}

function ensureTreasureChestAndKey(templates: ItemTemplate[]) {
  const hasChest = templates.some((template) => template.id === TREASURE_CHEST_TEMPLATE_ID);
  const hasKey = templates.some((template) => template.id === TREASURE_CHEST_KEY_TEMPLATE_ID);
  if (hasChest === hasKey) return;

  const presentTemplateId = hasChest ? TREASURE_CHEST_TEMPLATE_ID : TREASURE_CHEST_KEY_TEMPLATE_ID;
  const missingTemplateId = hasChest ? TREASURE_CHEST_KEY_TEMPLATE_ID : TREASURE_CHEST_TEMPLATE_ID;
  const missingTemplate = ITEM_TEMPLATES.find((template) => template.id === missingTemplateId);
  if (!missingTemplate) return;

  const eligibleIndexes = templates
    .map((template, index) => ({ template, index }))
    .filter(({ template }) => template.id !== presentTemplateId);
  const curioIndexes = eligibleIndexes.filter(({ template }) => itemClass(template) === 'curio');
  const replacementOptions = curioIndexes.length > 0 ? curioIndexes : eligibleIndexes;
  const replacement = replacementOptions[Math.floor(Math.random() * replacementOptions.length)];
  if (replacement) templates[replacement.index] = missingTemplate;
}

function pickWeighted<T>(entries: readonly { value: T; weight: number }[]): T {
  const totalWeight = entries.reduce((total, entry) => total + entry.weight, 0);
  let roll = Math.random() * totalWeight;
  for (const entry of entries) {
    roll -= entry.weight;
    if (roll < 0) return entry.value;
  }
  return entries[entries.length - 1].value;
}

function itemClass(template: ItemTemplate): 'weapon' | 'curio' | 'main' {
  if (template.weapon) return 'weapon';
  return template.traits.some((trait) => MAIN_TRAIT_IDS.includes(trait as MainTraitId)) ? 'main' : 'curio';
}

function selectMainTraits(mainTemplates: ItemTemplate[]): MainTraitId[] {
  const choices = MAIN_TRAIT_IDS
    .map((trait) => ({ value: trait, weight: mainTemplates.filter((template) => template.traits.includes(trait)).length }))
    .filter((entry) => entry.weight > 0);
  const selected: MainTraitId[] = [];
  while (selected.length < 3 && choices.length > 0) {
    const trait = pickWeighted(choices);
    selected.push(trait);
    choices.splice(choices.findIndex((entry) => entry.value === trait), 1);
  }
  return selected;
}

function drawMainTemplate(available: ItemTemplate[], selectedTraits: MainTraitId[]): ItemTemplate | undefined {
  const eligibleTraits = selectedTraits.filter((trait) => available.some((template) => template.traits.includes(trait)));
  if (eligibleTraits.length === 0) return undefined;
  const trait = pickWeighted(eligibleTraits.map((value) => ({ value, weight: available.filter((template) => template.traits.includes(value)).length })));
  const candidates = available.filter((template) => template.traits.includes(trait));
  const template = candidates[Math.floor(Math.random() * candidates.length)];
  available.splice(available.indexOf(template), 1);
  return template;
}

// A limited game first rolls Weapon/Curio/Main slot classes using the full item
// pool's proportions. Three weighted main attributes are then chosen and every
// Main slot draws only from those pools. Three extra templates stay in reserve
// for Arcane Staff transforms without affecting the auction's class mix.
function buildLotPool(room: Room) {
  // Open Bid already makes every clock public, so Spyglass (whose only
  // effect is revealing that) would have nothing left to grant — leave it
  // out of the pool entirely in that mode, reserves included.
  const templatePool = room.settings.openBidding
    ? ITEM_TEMPLATES.filter((template) => template.id !== 'spyglass')
    : ITEM_TEMPLATES;
  const maxRounds = room.settings.maxRounds;
  const roundsToPlay = maxRounds !== null ? Math.min(maxRounds, templatePool.length) : templatePool.length;
  const weaponTemplates = templatePool.filter((template) => itemClass(template) === 'weapon');
  const curioTemplates = templatePool.filter((template) => itemClass(template) === 'curio');
  const mainTemplates = templatePool.filter((template) => itemClass(template) === 'main');
  const classWeights = [
    { value: 'weapon' as const, weight: weaponTemplates.length },
    { value: 'curio' as const, weight: curioTemplates.length },
    { value: 'main' as const, weight: mainTemplates.length },
  ];
  const available = {
    weapon: [...weaponTemplates],
    curio: [...curioTemplates],
    main: [...mainTemplates],
  };
  const selectedMainTraits = maxRounds === null ? [...MAIN_TRAIT_IDS] : selectMainTraits(mainTemplates);
  room.selectedMainTraits = selectedMainTraits.slice(0, 3);
  const auctionTemplates: ItemTemplate[] = [];

  for (let slot = 0; slot < roundsToPlay; slot += 1) {
    const availableClasses = classWeights.filter((entry) => entry.value === 'main'
      ? selectedMainTraits.some((trait) => available.main.some((template) => template.traits.includes(trait)))
      : available[entry.value].length > 0);
    const itemType = pickWeighted(availableClasses.length > 0 ? availableClasses : classWeights);
    const template = itemType === 'main'
      ? drawMainTemplate(available.main, selectedMainTraits)
      : takeRandom(available[itemType]);
    if (!template) break;
    auctionTemplates.push(template);
  }

  // The Treasure Chest and Rusty Key always enter limited pools together.
  // Prefer replacing another random curio to preserve the rolled class mix;
  // if there is no other curio, replace any other item at random.
  ensureTreasureChestAndKey(auctionTemplates);

  const selectedIds = new Set(auctionTemplates.map((template) => template.id));
  const remainingTemplates = templatePool.filter((template) =>
    !selectedIds.has(template.id) &&
    (itemClass(template) !== 'main' || selectedMainTraits.some((trait) => template.traits.includes(trait)))
  );
  // Keep promoted utility curios out of reserve-only slots: if one is rolled,
  // it is guaranteed to be one of the first auction lots.
  const reserveCandidates = remainingTemplates.filter((template) => !EARLY_UTILITY_TEMPLATE_IDS.has(template.id));
  const reserveTemplates = shuffle(reserveCandidates.length >= 3 ? reserveCandidates : remainingTemplates).slice(0, 3);
  if (!auctionTemplates.some((template) =>
    template.id === TREASURE_CHEST_TEMPLATE_ID || template.id === TREASURE_CHEST_KEY_TEMPLATE_ID
  )) ensureTreasureChestAndKey(reserveTemplates);
  room.lotPool = [...auctionTemplates, ...reserveTemplates].map((template) => rollItemInstanceForTemplate(template.id, maxRounds));
  // Information and recovery curios should arrive early whenever they made it
  // into the auction pool, rather than being relegated to a later lot.
  const auctionItems = room.lotPool.slice(0, auctionTemplates.length);
  const earlyUtilityIds = shuffle(auctionItems.filter((item) => EARLY_UTILITY_TEMPLATE_IDS.has(item.templateId)).map((item) => item.id));
  const remainingIds = shuffle(auctionItems.filter((item) => !EARLY_UTILITY_TEMPLATE_IDS.has(item.templateId)).map((item) => item.id));
  room.auctionOrder = [...earlyUtilityIds, ...remainingIds];
  room.roundsToPlay = roundsToPlay;
  room.hiddenPoolItemIds = new Set(shuffle(room.lotPool.map((item) => item.id)).slice(0, Math.min(3, room.lotPool.length)));
  room.revealedPoolItemIds = new Set();
}

export function startGame(room: Room, io: IO) {
  if (room.status !== 'lobby') return;
  const eligiblePlayerCount = [...room.players.values()].filter((player) => !player.isObserver).length;
  if (eligiblePlayerCount < 2) return;
  room.status = 'in_round';
  buildLotPool(room);
  logSystemEvent(room, io, 'The game has started.');
  startRound(room, io);
}

export function startRound(room: Room, io: IO) {
  const eligible = [...room.players.values()].filter(
    (p) => p.status === 'active' && p.timeRemainingMs > 0 && !p.isObserver
  );

  if (eligible.length === 0) {
    finishGame(room, io);
    return;
  }

  const nextIndex = room.currentRoundIndex + 1;
  if (nextIndex >= room.auctionOrder.length) {
    finishGame(room, io);
    return;
  }

  const item = room.lotPool.find((i) => i.id === room.auctionOrder[nextIndex]);
  if (!item) {
    finishGame(room, io);
    return;
  }
  room.revealedPoolItemIds.add(item.id);

  const bidders: Round['bidders'] = {};
  for (const p of eligible) {
    bidders[p.id] = { isHolding: false, committedMs: 0, droppedAt: null };
  }

  room.roundCounter += 1;
  const round: Round = {
    id: `round-${room.roundCounter}`,
    itemInstanceId: item.id,
    status: 'pending',
    initialBidDeadlineAt: null,
    bidWindowOpen: false,
    spendingStartedAt: null,
    bidders,
    revealedFields: [],
    winnerId: null,
    soleBidder: false,
    stalematePlayerIds: [],
    restrictedBidderIds: null,
  };

  room.currentRoundIndex += 1;
  room.activeRound = {
    round,
    item,
    holdStartedAt: new Map(),
    hasAnyoneHeld: false,
    bidWindowOpen: false,
    noBidTimer: null,
    maxDurationTimer: null,
    interRoundTimer: null,
    modifierRevealTimers: [],
    allowedBidderIds: null,
  };

  emitRoundStart(room, io);
  scheduleModifierReveals(room, io);
  emitRoomState(room, io);

  setTimeout(() => activateRound(room, io), room.settings.pendingDurationMs);
}

function activateRound(room: Room, io: IO) {
  const ar = room.activeRound;
  if (!ar || ar.round.status !== 'pending') return;

  ar.round.status = 'active';
  ar.round.initialBidDeadlineAt = Date.now() + room.settings.noBidTimeoutMs;
  ar.round.bidWindowOpen = true;
  ar.bidWindowOpen = true;
  emitRoundStart(room, io);
  scheduleBotWeaponUses(room, io, 'preBid', useWeapon);
  scheduleBotEntries(room, io, handleHoldStart);

  ar.noBidTimer = setTimeout(() => closeBidWindow(room, io), room.settings.noBidTimeoutMs);

}

function closeBidWindow(room: Room, io: IO) {
  const ar = room.activeRound;
  if (!ar || ar.round.status !== 'active' || !ar.bidWindowOpen) return;

  ar.bidWindowOpen = false;
  ar.round.bidWindowOpen = false;
  ar.noBidTimer = null;

  const activeBidders = Object.entries(ar.round.bidders).filter(([, bidder]) => bidder.isHolding);
  if (activeBidders.length === 0) {
    resolveRound(room, io, null);
    return;
  }

  // One bidder means the opening window ended uncontested. Award the lot
  // immediately; resolveRound applies the fixed five-second sole-bid price.
  if (activeBidders.length === 1) {
    resolveRound(room, io, activeBidders[0][0]);
    return;
  }

  // Everyone who opted in during the opening window starts spending at the
  // same moment, regardless of when they pressed Bid.
  const spendingStartedAt = Date.now();
  ar.round.spendingStartedAt = spendingStartedAt;
  for (const [playerId] of activeBidders) {
    ar.holdStartedAt.set(playerId, spendingStartedAt);
  }
  scheduleBotWeaponUses(room, io, 'bidding', useWeapon);
  scheduleBotReleases(room, io, handleHoldRelease);

  // Holding to the buzzer is a mutual failure, not a win for anyone: every
  // holder started spending at the same instant, so there is nothing to
  // separate them. The lot passes, they get their time back, and it counts as
  // a loss for everyone who bid on it.
  ar.maxDurationTimer = setTimeout(() => {
    const stillHolding = Object.entries(ar.round.bidders).filter(([, bidder]) => bidder.isHolding);
    if (stillHolding.length === 0) return; // already resolved via checkResolution

    resolveRound(room, io, null, { stalemateIds: stillHolding.map(([playerId]) => playerId) });
  }, room.settings.maxRoundDurationMs);

  io.to(room.code).emit('bid_window_closed', { roundId: ar.round.id, spendingStartedAt });
  emitRoomState(room, io);
}

export function handleHoldStart(room: Room, playerId: string, io: IO) {
  const ar = room.activeRound;
  if (!ar || ar.round.status !== 'active') return;
  if (!ar.bidWindowOpen) return; // entrants are locked once spending begins
  if (ar.allowedBidderIds && !ar.allowedBidderIds.has(playerId)) return; // Dual Daggers locked this lot to specific players

  const bidder = ar.round.bidders[playerId];
  const player = room.players.get(playerId);
  if (!bidder || !player) return;
  if (bidder.isHolding || bidder.droppedAt !== null) return; // already holding, or folded already this round
  if (player.status !== 'active' || player.timeRemainingMs <= 0) return;

  bidder.isHolding = true;
  ar.hasAnyoneHeld = true;

  // During the opening window this only records an opt-in. Time begins for
  // all opted-in players together when closeBidWindow runs.
}

export function handleHoldRelease(room: Room, playerId: string, io: IO) {
  const ar = room.activeRound;
  if (!ar) return;

  const bidder = ar.round.bidders[playerId];
  const player = room.players.get(playerId);
  if (!bidder || !player || !bidder.isHolding) return;

  // Cancelling during the opt-in window costs nothing and leaves the player
  // free to bid again before the window closes.
  if (ar.bidWindowOpen) {
    bidder.isHolding = false;
    bidder.committedMs = 0;
    bidder.droppedAt = null;
    io.to(playerId).emit('bidder_cancelled', { roundId: ar.round.id, playerId });
    return;
  }

  if (!forceWithdraw(room, io, ar, playerId)) return;
  emitRoomState(room, io);

  // Bidding is an opt-in phase: a lone bidder stays in until they choose to
  // withdraw. When the final active bidder withdraws, they win the lot.
  checkResolution(room, io, playerId);
}

// Core withdrawal accounting shared by a player's own release and any weapon
// effect that forces someone out. Charges elapsed time and reveals it to
// whoever's entitled to see it (the player themself, or a Spyglass owner) —
// callers decide what to do about resolution afterward.
function forceWithdraw(room: Room, io: IO, ar: ActiveRound, playerId: string): boolean {
  const bidder = ar.round.bidders[playerId];
  const player = room.players.get(playerId);
  const startedAt = ar.holdStartedAt.get(playerId);
  if (!bidder || !player || !bidder.isHolding || startedAt === undefined) return false;

  const elapsed = Date.now() - startedAt;
  ar.holdStartedAt.delete(playerId);

  player.timeRemainingMs = Math.max(0, player.timeRemainingMs - elapsed);
  if (player.timeRemainingMs <= 0) {
    player.timeRemainingMs = 0;
    player.status = 'out_of_time';
  }

  bidder.isHolding = false;
  bidder.committedMs = elapsed;
  bidder.droppedAt = Date.now();

  emitBidderDropped(room, io, { roundId: ar.round.id, playerId, committedMs: elapsed });
  return true;
}

function checkResolution(room: Room, io: IO, lastWithdrawerId: string | null = null) {
  const ar = room.activeRound;
  if (!ar || ar.round.status !== 'active') return;

  const stillHolding = Object.entries(ar.round.bidders).filter(([, b]) => b.isHolding);

  if (stillHolding.length === 0 && ar.hasAnyoneHeld) {
    resolveRound(room, io, lastWithdrawerId);
  }
}

function resolveRound(room: Room, io: IO, winnerId: string | null, opts?: { stalemateIds: string[] }) {
  const ar = room.activeRound;
  if (!ar || ar.round.status === 'resolved') return;

  const stalemateIds = new Set(opts?.stalemateIds ?? []);

  if (ar.noBidTimer) clearTimeout(ar.noBidTimer);
  if (ar.maxDurationTimer) clearTimeout(ar.maxDurationTimer);
  for (const timer of ar.modifierRevealTimers) clearTimeout(timer);

  const template = getTemplate(ar.item.templateId);

  const bidderCount = Object.values(ar.round.bidders).filter((bidder) => bidder.isHolding || bidder.droppedAt !== null).length;

  // Whoever is still mid-hold at resolution (normally just the winner, but
  // possibly several in a max-duration stalemate) has to pay for that time
  // now — resolving doesn't happen via their own release, so nothing else
  // deducts it.
  const now = Date.now();
  for (const [playerId, startedAt] of [...ar.holdStartedAt]) {
    const bidder = ar.round.bidders[playerId];
    const player = room.players.get(playerId);
    if (!bidder || !player) continue;

    const rawElapsed = now - startedAt;
    // What the clock could actually absorb — a player who ran out mid-hold was
    // charged less than they held for, and a stalemate must not refund more.
    const charged = Math.min(rawElapsed, player.timeRemainingMs);

    player.timeRemainingMs = Math.max(0, player.timeRemainingMs - rawElapsed);
    if (player.timeRemainingMs <= 0) {
      player.timeRemainingMs = 0;
      player.status = 'out_of_time';
    }

    bidder.isHolding = false;
    bidder.committedMs = rawElapsed;
    bidder.droppedAt = now;
    ar.holdStartedAt.delete(playerId);

    // Stalemate: hand back exactly what the buzzer cost them.
    if (stalemateIds.has(playerId) && charged > 0) {
      player.timeRemainingMs += charged;
      if (player.timeRemainingMs > 0) player.status = 'active';
    }
  }

  ar.round.status = 'resolved';
  ar.round.winnerId = winnerId;
  ar.round.soleBidder = winnerId !== null && bidderCount === 1;
  ar.round.stalematePlayerIds = [...stalemateIds];

  // A stalemate counts as a loss for everyone who bid on the lot, so nobody's
  // streak survives it — unlike a lot that simply went unbid.
  if (stalemateIds.size > 0) {
    for (const playerId of Object.keys(ar.round.bidders)) {
      const player = room.players.get(playerId);
      if (player) player.winStreak = 0;
    }
  }

  if (winnerId) {
    // Win streaks (Gambler): a sold lot extends the winner's streak and
    // resets everyone else who was eligible this round. A lot that simply went
    // unbid leaves every streak untouched — nothing was won away from anyone.
    // (A stalemate does break them; that's handled above.)
    for (const playerId of Object.keys(ar.round.bidders)) {
      const player = room.players.get(playerId);
      if (!player) continue;
      player.winStreak = playerId === winnerId ? player.winStreak + 1 : 0;
    }

    const winner = room.players.get(winnerId);
    if (winner) {
      const winnerBidder = ar.round.bidders[winnerId];
      const runnerUpPrice = Math.max(
        0,
        ...Object.entries(ar.round.bidders)
          .filter(([playerId, bidder]) => playerId !== winnerId && bidder.droppedAt !== null)
          .map(([, bidder]) => bidder.committedMs)
      );
      const rawPrice = winnerBidder?.committedMs ?? 0;
      const requestedPrice = bidderCount === 1 ? SOLE_BIDDER_PRICE_MS : ar.item.fairTrade ? runnerUpPrice : rawPrice;
      const paidPrice = Math.min(requestedPrice, winner.timeRemainingMs + rawPrice);

      // The bid was initially charged at raw time. Refund or charge the
      // difference for Fair Trade and the fixed uncontested price.
      winner.timeRemainingMs = Math.max(0, winner.timeRemainingMs + rawPrice - paidPrice);
      winner.status = winner.timeRemainingMs > 0 ? 'active' : 'out_of_time';
      if (winnerBidder) winnerBidder.committedMs = paidPrice;
      room.itemPricePaidMs.set(ar.item.id, paidPrice);

      winner.stash.push(ar.item.id);
      room.wonItems.set(ar.item.id, ar.item);

      if (template?.effectType === 'timeRefund' && template.timeRefund) {
        const refund = computeTimeRefund(template.timeRefund, winner.timeRemainingMs, room.settings.startingTimeMs);
        if (refund > 0) {
          winner.timeRemainingMs += refund;
          if (winner.status === 'out_of_time') winner.status = 'active';
        }
      }

      // Auctioneer: takes a commission rebate of time back on every lot won.
      if (winner.classId === 'auctioneer' && paidPrice > 0) {
        winner.timeRemainingMs += Math.round(paidPrice * AUCTIONEER_REBATE_RATE);
        if (winner.status === 'out_of_time') winner.status = 'active';
      }

      // Gambler: rebate grows with the just-updated streak (already includes this win).
      if (winner.classId === 'gambler' && paidPrice > 0) {
        const streakLevel = Math.min(winner.winStreak, GAMBLER_MAX_STREAK_WINS);
        const rebate = Math.round(paidPrice * GAMBLER_STREAK_REBATE_RATE_PER_WIN * streakLevel);
        if (rebate > 0) {
          winner.timeRemainingMs += rebate;
          if (winner.status === 'out_of_time') winner.status = 'active';
        }
      }

      tryOpenChests(room, winner);
    }
  }

  // Chronomancer's Hourglass: anyone who spent time on this lot and didn't
  // win it gets part of that time back. Insurer is the same idea as a
  // passive class ability, but at a lower refund rate — the two don't stack.
  // Stalemate holders were already made whole above, so the Hourglass has
  // nothing left to give them; the Insurer still pays out on top, coming out
  // of the stalemate ahead. Anyone who folded earlier in the round is a normal
  // loser and gets the normal treatment either way.
  for (const [playerId, bidder] of Object.entries(ar.round.bidders)) {
    if (playerId === winnerId || bidder.droppedAt === null || bidder.committedMs <= 0) continue;

    const loser = room.players.get(playerId);
    if (!loser) continue;

    if (ownsItemTemplate(room, playerId, 'chronomancers-hourglass') && !stalemateIds.has(playerId)) {
      loser.timeRemainingMs += Math.round(bidder.committedMs * HOURGLASS_REFUND_RATE);
    } else if (loser.classId === 'insurer') {
      loser.timeRemainingMs += Math.round(bidder.committedMs * INSURER_REFUND_RATE);
    } else {
      continue;
    }
    if (loser.status === 'out_of_time' && loser.timeRemainingMs > 0) loser.status = 'active';
  }

  // Investor: unspent time quietly earns interest at the end of every round.
  for (const player of room.players.values()) {
    if (player.classId !== 'investor' || player.status !== 'active' || player.timeRemainingMs <= 0) continue;
    player.timeRemainingMs += Math.round(player.timeRemainingMs * INVESTOR_INTEREST_RATE);
  }

  const itemName = template?.name ?? ar.item.templateId;
  const winner = winnerId ? room.players.get(winnerId) : undefined;
  logGameEvent(
    room,
    io,
    winner ? `${itemName} was won by ${winner.name}.` : `${itemName} was passed.`
  );

  io.to(room.code).emit('round_end', { round: publicRoundResult(ar.round), item: ar.item });
  emitRoomState(room, io);

  ar.interRoundTimer = setTimeout(() => {
    room.activeRound = null;
    const reachedRoundLimit = room.currentRoundIndex + 1 >= room.roundsToPlay;
    const stillPlaying = [...room.players.values()].some(
      (p) => p.status === 'active' && p.timeRemainingMs > 0 && !p.isObserver
    );
    if (!reachedRoundLimit && stillPlaying) startRound(room, io);
    else finishGame(room, io);
  }, room.settings.interRoundDelayMs);
}

function finishGame(room: Room, io: IO) {
  room.status = 'game_over';
  room.activeRound = null;
  emitRoomState(room, io);

  const players = [...room.players.values()].filter((p) => !p.isObserver);
  const scores = computeScores(players, room.wonItems, room.itemPricePaidMs);
  io.to(room.code).emit('game_over', { players, scores });
}

// Clears round/round-timers/status back to a fresh lobby. Also promotes any
// observers back to full players — a reset means "everyone currently here
// plays the next one." Callers are responsible for emitting room_state.
export function resetRoomToLobby(room: Room) {
  if (room.activeRound) {
    if (room.activeRound.noBidTimer) clearTimeout(room.activeRound.noBidTimer);
    if (room.activeRound.maxDurationTimer) clearTimeout(room.activeRound.maxDurationTimer);
    if (room.activeRound.interRoundTimer) clearTimeout(room.activeRound.interRoundTimer);
    for (const timer of room.activeRound.modifierRevealTimers) clearTimeout(timer);
  }

  room.status = 'lobby';
  room.currentRoundIndex = -1;
  room.activeRound = null;
  room.lotPool = [];
  room.auctionOrder = [];
  room.roundsToPlay = 0;
  room.selectedMainTraits = [];
  room.hiddenPoolItemIds = new Set();
  room.revealedPoolItemIds = new Set();
  room.wonItems.clear();
  room.itemPricePaidMs.clear();

  for (const player of room.players.values()) {
    player.timeRemainingMs = room.settings.startingTimeMs;
    player.status = 'active';
    player.stash = [];
    player.winStreak = 0;
    player.isObserver = false;
  }
}

export function restartGame(room: Room, io: IO) {
  if (room.status !== 'game_over') return;
  resetRoomToLobby(room);
  emitRoomState(room, io);
}

// Dev-only escape hatch — resets from ANY state, no guard. Remove before shipping.
export function forceResetGame(room: Room, io: IO) {
  resetRoomToLobby(room);
  for (const [id, player] of room.players) {
    if (player.isBot) room.players.delete(id);
  }
  emitRoomState(room, io);
}

// Sends the winner's amount to whoever is entitled to see it: the withdrawer
// themself, plus anyone currently holding a Spyglass.
function emitBidderDropped(room: Room, io: IO, payload: { roundId: string; playerId: string; committedMs: number }) {
  for (const viewerId of humanPlayerIds(room)) {
    if (viewerId === payload.playerId || room.settings.openBidding || ownsItemTemplate(room, viewerId, 'spyglass')) {
      io.to(viewerId).emit('bidder_dropped', payload);
    }
  }
}

// Combining a chest with its matching key consumes both and grants a handful
// of random items from the chest's reward trait. Checked right after a win
// changes the winner's stash, since that's the only way stash contents change.
function tryOpenChests(room: Room, player: Player) {
  for (const chestTemplate of ITEM_TEMPLATES) {
    if (!chestTemplate.chest) continue;

    const chestItemId = player.stash.find((id) => room.wonItems.get(id)?.templateId === chestTemplate.id);
    const keyItemId = player.stash.find((id) => room.wonItems.get(id)?.templateId === chestTemplate.chest!.keyTemplateId);
    if (!chestItemId || !keyItemId) continue;

    player.stash = player.stash.filter((id) => id !== chestItemId && id !== keyItemId);

    const { grantsTraitId, grantsCountRange } = chestTemplate.chest;
    const [min, max] = grantsCountRange;
    const grantCount = min + Math.floor(Math.random() * (max - min + 1));
    const pool = ITEM_TEMPLATES.filter((t) => t.traits.includes(grantsTraitId));

    for (let i = 0; i < grantCount && pool.length > 0; i++) {
      const grantTemplate = pool[Math.floor(Math.random() * pool.length)];
      const grantedItem = rollItemInstanceForTemplate(grantTemplate.id, room.settings.maxRounds);
      room.wonItems.set(grantedItem.id, grantedItem);
      player.stash.push(grantedItem.id);
    }
  }
}

// Mirror of Desire: consumes itself and grants an exact duplicate of another
// player's chosen item. Usable any time it's owned, not just mid-round.
export function useMirror(
  room: Room,
  io: IO,
  playerId: string,
  itemId: string,
  copyItemId: string
): { ok: true } | { ok: false; error: string } {
  const player = room.players.get(playerId);
  if (!player) return { ok: false, error: 'Not in game.' };
  if (!player.stash.includes(itemId)) return { ok: false, error: 'Item not found in your inventory.' };

  const mirrorItem = room.wonItems.get(itemId);
  const template = mirrorItem ? getTemplate(mirrorItem.templateId) : undefined;
  if (!mirrorItem || template?.effectType !== 'copyItem') return { ok: false, error: 'That item has no copy effect.' };

  const targetItem = room.wonItems.get(copyItemId);
  const targetOwner = targetItem
    ? [...room.players.values()].find((p) => p.id !== playerId && p.stash.includes(copyItemId))
    : undefined;
  if (!targetItem || !targetOwner) return { ok: false, error: 'That item is no longer available to copy.' };

  player.stash = player.stash.filter((id) => id !== itemId);
  const copy = cloneItemInstance(targetItem);
  room.wonItems.set(copy.id, copy);
  player.stash.push(copy.id);
  tryOpenChests(room, player);
  logGameEvent(room, io, `${player.name} has used ${template.name} on ${targetOwner.name}.`);
  io.to(room.code).emit('mirror_used', { playerId, itemId });

  return { ok: true };
}

// Dispatches every weapon's one-time active effect. On success the item is
// flagged usedActiveEffect (never removed — it just stops being usable).
export function useWeapon(
  room: Room,
  io: IO,
  playerId: string,
  itemId: string,
  targetPlayerId?: string,
  targetItemId?: string
): { ok: true } | { ok: false; error: string } {
  const actor = room.players.get(playerId);
  if (!actor) return { ok: false, error: 'Not in game.' };
  if (!actor.stash.includes(itemId)) return { ok: false, error: 'Item not found in your inventory.' };

  const item = room.wonItems.get(itemId);
  const template = item ? getTemplate(item.templateId) : undefined;
  if (!item || !template?.weapon) return { ok: false, error: 'That item has no active effect.' };
  if (item.usedActiveEffect) return { ok: false, error: 'Already used.' };

  const ar = room.activeRound;
  const { phase, target, exclusive } = template.weapon;

  if (phase === 'preBid' && !(ar && ar.round.status === 'active' && ar.bidWindowOpen)) {
    return { ok: false, error: 'Can only be used before bidding opens on a lot.' };
  }
  if (phase === 'bidding' && !(ar && ar.round.status === 'active' && !ar.bidWindowOpen)) {
    return { ok: false, error: 'Can only be used while bidding is underway.' };
  }

  const affectedPlayerNames: string[] = [];

  switch (template.effectType) {
    case 'destroyLot': {
      resolveRound(room, io, null);
      break;
    }

    case 'forceEnter': {
      if (target === 'all') {
        for (const [pid, bidder] of Object.entries(ar!.round.bidders)) {
          if (pid === playerId || bidder.isHolding || bidder.droppedAt !== null) continue;
          const p = room.players.get(pid);
          if (!p || p.status !== 'active' || p.timeRemainingMs <= 0) continue;
          bidder.isHolding = true;
          ar!.hasAnyoneHeld = true;
          affectedPlayerNames.push(p.name);
        }
      } else {
        if (!targetPlayerId || targetPlayerId === playerId) return { ok: false, error: 'Choose another player to target.' };
        const bidder = ar!.round.bidders[targetPlayerId];
        const targetPlayer = room.players.get(targetPlayerId);
        if (!bidder || !targetPlayer) return { ok: false, error: 'That player is not in this round.' };
        if (bidder.droppedAt !== null) return { ok: false, error: 'That player already withdrew this round.' };

        bidder.isHolding = true;
        ar!.hasAnyoneHeld = true;
        affectedPlayerNames.push(targetPlayer.name);

        if (exclusive) {
          const allowed = new Set([playerId, targetPlayerId]);
          ar!.allowedBidderIds = allowed;
          ar!.round.restrictedBidderIds = [...allowed];
          for (const [pid, b] of Object.entries(ar!.round.bidders)) {
            if (allowed.has(pid) || !b.isHolding) continue;
            b.isHolding = false;
            b.committedMs = 0;
            b.droppedAt = null;
            io.to(pid).emit('bidder_cancelled', { roundId: ar!.round.id, playerId: pid });
          }
          io.to(room.code).emit('bid_restricted', { roundId: ar!.round.id, allowedPlayerIds: [...allowed] });
        }
      }
      break;
    }

    case 'forceWithdraw': {
      const targets: string[] = [];
      if (target === 'all') {
        for (const [pid, bidder] of Object.entries(ar!.round.bidders)) {
          if (pid !== playerId && bidder.isHolding) targets.push(pid);
        }
      } else {
        if (!targetPlayerId) return { ok: false, error: 'Choose a player to target.' };
        const bidder = ar!.round.bidders[targetPlayerId];
        if (!bidder || !bidder.isHolding) return { ok: false, error: 'That player is not currently bidding.' };
        targets.push(targetPlayerId);
      }
      for (const pid of targets) {
        const targetPlayer = room.players.get(pid);
        if (targetPlayer) affectedPlayerNames.push(targetPlayer.name);
      }
      for (const pid of targets) forceWithdraw(room, io, ar!, pid);
      checkResolution(room, io, null);
      break;
    }

    case 'destroyItem': {
      if (!targetPlayerId || !targetItemId) return { ok: false, error: 'Choose an item to destroy.' };
      if (targetPlayerId === playerId) return { ok: false, error: "Choose another player's item." };
      const targetPlayer = room.players.get(targetPlayerId);
      if (!targetPlayer || !targetPlayer.stash.includes(targetItemId)) return { ok: false, error: 'Item not found.' };
      affectedPlayerNames.push(targetPlayer.name);
      targetPlayer.stash = targetPlayer.stash.filter((id) => id !== targetItemId);
      break;
    }

    case 'stealTime': {
      if (!targetPlayerId || targetPlayerId === playerId) return { ok: false, error: 'Choose another player to target.' };
      const targetPlayer = room.players.get(targetPlayerId);
      if (!targetPlayer || targetPlayer.isObserver) return { ok: false, error: 'That player cannot be targeted.' };
      if (targetPlayer.timeRemainingMs <= 0) return { ok: false, error: 'That player has no time remaining.' };
      affectedPlayerNames.push(targetPlayer.name);
      const stolenTimeMs = Math.min(5_000, targetPlayer.timeRemainingMs);
      targetPlayer.timeRemainingMs -= stolenTimeMs;
      actor.timeRemainingMs += stolenTimeMs;
      if (targetPlayer.timeRemainingMs <= 0) {
        targetPlayer.status = 'out_of_time';
        const targetBidder = ar?.round.bidders[targetPlayerId];
        if (targetBidder?.isHolding && ar) {
          if (ar.bidWindowOpen) {
            targetBidder.isHolding = false;
            targetBidder.committedMs = 0;
            targetBidder.droppedAt = null;
            io.to(targetPlayerId).emit('bidder_cancelled', { roundId: ar.round.id, playerId: targetPlayerId });
          } else if (forceWithdraw(room, io, ar, targetPlayerId)) {
            checkResolution(room, io, targetPlayerId);
          }
        }
      }
      if (actor.timeRemainingMs > 0 && actor.status === 'out_of_time') actor.status = 'active';
      break;
    }

    case 'transformLot': {
      if (!transformLot(room, io, ar!)) return { ok: false, error: 'No reserve items left to swap in.' };
      break;
    }

    default:
      return { ok: false, error: 'That item has no active effect.' };
  }

  item.usedActiveEffect = true;
  logGameEvent(
    room,
    io,
    `${actor.name} has used ${template.name}${affectedPlayerNames.length > 0 ? ` on ${affectedPlayerNames.join(', ')}` : ''}.`
  );
  io.to(room.code).emit('weapon_used', { playerId, itemId });
  emitRoomState(room, io);
  return { ok: true };
}

// Prospector skips the staggered reveal entirely, showing rarity/material/
// specialModifier up front — a persistent effect re-checked every time the
// lot is (re-)announced, including after an Arcane Staff transform. Appraiser
// additionally sees the hidden trait before bidding even opens. trueValue is
// always public now (base value is fixed), so it needs no masking.
function maskedItemForSocket(room: Room, ar: ActiveRound, socketId: string): MaskedRoundItem {
  const { hiddenTraitId, material, rarity, specialModifier, ...publicItem } = ar.item;
  const revealed: MaskedRoundItem = playerHasClass(room, socketId, 'prospector')
    ? { ...publicItem, material, rarity, specialModifier, modifiersRevealedInstantly: true }
    : publicItem;
  return playerHasClass(room, socketId, 'appraiser') ? { ...revealed, hiddenTraitId } : revealed;
}

function emitRoundStart(room: Room, io: IO) {
  const ar = room.activeRound;
  if (!ar) return;
  for (const viewerId of humanPlayerIds(room)) {
    io.to(viewerId).emit('round_start', { round: ar.round, item: maskedItemForSocket(room, ar, viewerId) });
  }
}

// Arcane Staff: swaps the active lot for one of the pool's reserve items —
// the ones never scheduled for any round, so pulling one in doesn't disturb
// what's coming later. The displaced item silently drops out (already seen,
// never sold) and effectively becomes a new reserve in its place. Bidder
// state (who's in, who's holding, elapsed time) is untouched — only what
// they're bidding on changes. Returns false if no reserves remain.
function transformLot(room: Room, io: IO, ar: ActiveRound): boolean {
  // A reserve is a pool item never scheduled for any round (past, present, or
  // future) and not already used up by an earlier transform this game.
  const scheduled = new Set(room.auctionOrder);
  const reserves = room.lotPool.filter((candidate) => !scheduled.has(candidate.id) && !room.revealedPoolItemIds.has(candidate.id));
  if (reserves.length === 0) return false;

  const newItem = reserves[Math.floor(Math.random() * reserves.length)];
  room.revealedPoolItemIds.add(newItem.id);
  ar.item = newItem;
  ar.round.revealedFields = [];

  for (const timer of ar.modifierRevealTimers) clearTimeout(timer);
  ar.modifierRevealTimers = [];

  for (const viewerId of humanPlayerIds(room)) {
    io.to(viewerId).emit('lot_transformed', { roundId: ar.round.id, item: maskedItemForSocket(room, ar, viewerId) });
  }
  scheduleModifierReveals(room, io);
  return true;
}

function scheduleModifierReveals(room: Room, io: IO) {
  const ar = room.activeRound;
  if (!ar) return;

  const modifiers: Array<[field: 'material' | 'rarity' | 'specialModifier', value: string | undefined]> = [
    ['material', ar.item.material],
    ['rarity', ar.item.rarity],
    ['specialModifier', ar.item.specialModifier],
  ];

  modifiers.forEach(([field, value], index) => {
    if (value === undefined) return;
    const reveal = () => {
      if (room.activeRound !== ar) return;
      ar.round.revealedFields.push(field);
      io.to(room.code).emit('reveal', { roundId: ar.round.id, field, value });
    };

    if (index === 0) reveal();
    else ar.modifierRevealTimers.push(setTimeout(reveal, index * MODIFIER_REVEAL_INTERVAL_MS));
  });
}

// Do not reveal losing bidders' spend to other players. The winner's final
// committed time is intentionally preserved for the result screen.
function publicRoundResult(round: Round): Round {
  const bidders: Round['bidders'] = {};
  for (const [playerId, bidder] of Object.entries(round.bidders)) {
    // Stalemate holders are revealed alongside the winner — they've been
    // refunded, so there's nothing left to keep secret about what they held.
    bidders[playerId] =
      playerId === round.winnerId || round.stalematePlayerIds.includes(playerId)
        ? { ...bidder }
        : { isHolding: false, committedMs: 0, droppedAt: null };
  }
  return { ...round, bidders };
}

function computeTimeRefund(config: TimeRefundConfig, currentTimeRemainingMs: number, startingTimeMs: number): number {
  if (config.mode === 'flat') return config.amountMs;
  // catchup: full amount at ~0 remaining time, scaling down to 0 once back at/above starting time
  const ratio = Math.max(0, 1 - currentTimeRemainingMs / startingTimeMs);
  return Math.round(config.amountMs * ratio);
}

export function tickRoom(room: Room, io: IO) {
  const ar = room.activeRound;
  if (!ar || ar.round.status !== 'active') return;

  const now = Date.now();
  const players: Record<string, number> = {};
  const bidders: Record<string, number> = {};

  for (const p of room.players.values()) {
    const startedAt = ar.holdStartedAt.get(p.id);
    players[p.id] = startedAt ? Math.max(0, p.timeRemainingMs - (now - startedAt)) : p.timeRemainingMs;
  }

  for (const [playerId, startedAt] of ar.holdStartedAt) {
    bidders[playerId] = now - startedAt;
  }

  // Who has entered this lot is public (so others can see it's contested),
  // but the actual time/money each of them has committed stays private. This
  // stays true once someone withdraws (droppedAt set) — it's an "entered"
  // indicator, not a "currently holding" one. A free cancel during the opt-in
  // window resets droppedAt back to null too, so that correctly drops out.
  const holding = Object.entries(ar.round.bidders)
    .filter(([, bidder]) => bidder.isHolding || bidder.droppedAt !== null)
    .map(([playerId]) => playerId);

  // A player sees only their own live clock and spend, unless they hold a
  // Spyglass — or the whole room is playing Open Bid, where every clock is
  // public by design — either of which reveals everyone's.
  for (const viewerId of humanPlayerIds(room)) {
    const seesAll = room.settings.openBidding || ownsItemTemplate(room, viewerId, 'spyglass');
    const ownTime = players[viewerId];
    const ownBid = bidders[viewerId];
    io.to(viewerId).emit('round_tick', {
      players: seesAll ? players : ownTime === undefined ? {} : { [viewerId]: ownTime },
      bidders: seesAll ? bidders : ownBid === undefined ? {} : { [viewerId]: ownBid },
      holding,
    });
  }

  // Force-release anyone who has run out of time while holding.
  for (const [playerId, startedAt] of [...ar.holdStartedAt]) {
    const player = room.players.get(playerId);
    if (player && player.timeRemainingMs - (now - startedAt) <= 0) {
      handleHoldRelease(room, playerId, io);
    }
  }
}
