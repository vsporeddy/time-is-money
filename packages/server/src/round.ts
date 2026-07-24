import type { Server } from 'socket.io';
import type { ClientToServerEvents, Player, Round, ServerToClientEvents, TimeRefundConfig } from 'shared';
import { cloneItemInstance, computeScores, getTemplate, ITEM_TEMPLATES, rollItemInstance, rollItemInstanceForTemplate } from 'shared';
import { emitRoomState, ownsItemTemplate } from './rooms.js';
import type { Room } from './rooms.js';
import { scheduleBotEntries, scheduleBotReleases } from './bots.js';

type IO = Server<ClientToServerEvents, ServerToClientEvents>;

let roundCounter = 0;
const SOLE_BIDDER_PRICE_MS = 5_000;
const MODIFIER_REVEAL_INTERVAL_MS = 8_000;

export function startGame(room: Room, io: IO) {
  if (room.status !== 'lobby') return;
  room.status = 'in_round';
  startRound(room, io);
}

export function startRound(room: Room, io: IO) {
  const eligible = [...room.players.values()].filter((p) => p.status === 'active' && !p.isObserver);

  if (eligible.length === 0) {
    finishGame(room, io);
    return;
  }

  if (room.usedItemTemplateIds.size >= ITEM_TEMPLATES.length) {
    finishGame(room, io);
    return;
  }

  const item = rollItemInstance(room.settings.maxRounds, room.usedItemTemplateIds);
  room.usedItemTemplateIds.add(item.templateId);
  const bidders: Round['bidders'] = {};
  for (const p of eligible) {
    bidders[p.id] = { isHolding: false, committedMs: 0, droppedAt: null };
  }

  roundCounter += 1;
  const round: Round = {
    id: `round-${roundCounter}`,
    itemInstanceId: item.id,
    status: 'pending',
    initialBidDeadlineAt: null,
    bidWindowOpen: false,
    spendingStartedAt: null,
    bidders,
    revealedFields: [],
    winnerId: null,
    soleBidder: false,
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
  scheduleBotReleases(room, io, handleHoldRelease);

  ar.maxDurationTimer = setTimeout(() => {
    const stillHolding = Object.entries(ar.round.bidders).filter(([, bidder]) => bidder.isHolding);
    if (stillHolding.length === 0) return; // already resolved via checkResolution

    const now = Date.now();
    const [winnerId] = stillHolding.reduce((best, current) => {
      const bestElapsed = now - (ar.holdStartedAt.get(best[0]) ?? now);
      const currentElapsed = now - (ar.holdStartedAt.get(current[0]) ?? now);
      return currentElapsed > bestElapsed ? current : best;
    });
    resolveRound(room, io, winnerId);
  }, room.settings.maxRoundDurationMs);

  io.emit('bid_window_closed', { roundId: ar.round.id, spendingStartedAt });
  emitRoomState(room, io);
}

export function handleHoldStart(room: Room, playerId: string, io: IO) {
  const ar = room.activeRound;
  if (!ar || ar.round.status !== 'active') return;
  if (!ar.bidWindowOpen) return; // entrants are locked once spending begins

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
  const startedAt = ar.holdStartedAt.get(playerId);
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

  if (startedAt === undefined) return;

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

  // A player's spent time is private until the final result — except to
  // whoever holds a Spyglass, which reveals it live.
  emitBidderDropped(room, io, { roundId: ar.round.id, playerId, committedMs: elapsed });
  emitRoomState(room, io);

  // Bidding is an opt-in phase: a lone bidder stays in until they choose to
  // withdraw. When the final active bidder withdraws, they win the lot.
  checkResolution(room, io, playerId);
}

function checkResolution(room: Room, io: IO, lastWithdrawerId: string | null = null) {
  const ar = room.activeRound;
  if (!ar || ar.round.status !== 'active') return;

  const stillHolding = Object.entries(ar.round.bidders).filter(([, b]) => b.isHolding);

  if (stillHolding.length === 0 && ar.hasAnyoneHeld) {
    resolveRound(room, io, lastWithdrawerId);
  }
}

function resolveRound(room: Room, io: IO, winnerId: string | null) {
  const ar = room.activeRound;
  if (!ar || ar.round.status === 'resolved') return;

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

    player.timeRemainingMs = Math.max(0, player.timeRemainingMs - rawElapsed);
    if (player.timeRemainingMs <= 0) {
      player.timeRemainingMs = 0;
      player.status = 'out_of_time';
    }

    bidder.isHolding = false;
    bidder.committedMs = rawElapsed;
    bidder.droppedAt = now;
    ar.holdStartedAt.delete(playerId);

  }

  ar.round.status = 'resolved';
  ar.round.winnerId = winnerId;
  ar.round.soleBidder = winnerId !== null && bidderCount === 1;

  if (winnerId) {
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
      if (winner.timeRemainingMs > 0 && winner.status === 'out_of_time') winner.status = 'active';
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

      tryOpenChests(room, winner);
    }
  }

  // Chronomancer's Hourglass: anyone who spent time on this lot and didn't
  // win it gets that time back.
  for (const [playerId, bidder] of Object.entries(ar.round.bidders)) {
    if (playerId === winnerId || bidder.droppedAt === null || bidder.committedMs <= 0) continue;
    if (!ownsItemTemplate(room, playerId, 'chronomancers-hourglass')) continue;

    const loser = room.players.get(playerId);
    if (!loser) continue;
    loser.timeRemainingMs += bidder.committedMs;
    if (loser.status === 'out_of_time' && loser.timeRemainingMs > 0) loser.status = 'active';
  }

  io.emit('round_end', { round: publicRoundResult(ar.round), item: ar.item });
  emitRoomState(room, io);

  ar.interRoundTimer = setTimeout(() => {
    room.activeRound = null;
    const reachedRoundLimit =
      room.settings.maxRounds !== null && room.currentRoundIndex + 1 >= room.settings.maxRounds;
    const stillPlaying = [...room.players.values()].some((p) => p.status === 'active');
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
  io.emit('game_over', { players, scores });
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
  room.usedItemTemplateIds.clear();
  room.wonItems.clear();
  room.itemPricePaidMs.clear();

  for (const player of room.players.values()) {
    player.timeRemainingMs = room.settings.startingTimeMs;
    player.status = 'active';
    player.stash = [];
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
  for (const socketId of io.sockets.sockets.keys()) {
    if (socketId === payload.playerId || ownsItemTemplate(room, socketId, 'spyglass')) {
      io.to(socketId).emit('bidder_dropped', payload);
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
  const ownedByOther = targetItem
    ? [...room.players.values()].some((p) => p.id !== playerId && p.stash.includes(copyItemId))
    : false;
  if (!targetItem || !ownedByOther) return { ok: false, error: 'That item is no longer available to copy.' };

  player.stash = player.stash.filter((id) => id !== itemId);
  const copy = cloneItemInstance(targetItem);
  room.wonItems.set(copy.id, copy);
  player.stash.push(copy.id);
  tryOpenChests(room, player);

  return { ok: true };
}

function emitRoundStart(room: Room, io: IO) {
  const ar = room.activeRound;
  if (!ar) return;
  const { trueValue, hiddenTraitId: _hiddenTraitId, material, rarity, specialModifier, ...publicItem } = ar.item;

  for (const socketId of io.sockets.sockets.keys()) {
    // The Magnifying Glass skips the staggered reveal entirely and shows the
    // true value up front — a persistent effect re-checked every round.
    const item = ownsItemTemplate(room, socketId, 'magnifying-glass')
      ? { ...publicItem, material, rarity, specialModifier, revealedValue: trueValue }
      : publicItem;
    io.to(socketId).emit('round_start', { round: ar.round, item });
  }
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
      io.emit('reveal', { roundId: ar.round.id, field, value });
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
    bidders[playerId] =
      playerId === round.winnerId
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
  // Spyglass — that reveals everyone's.
  for (const socketId of io.sockets.sockets.keys()) {
    const hasSpyglass = ownsItemTemplate(room, socketId, 'spyglass');
    const ownTime = players[socketId];
    const ownBid = bidders[socketId];
    io.to(socketId).emit('round_tick', {
      players: hasSpyglass ? players : ownTime === undefined ? {} : { [socketId]: ownTime },
      bidders: hasSpyglass ? bidders : ownBid === undefined ? {} : { [socketId]: ownBid },
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
