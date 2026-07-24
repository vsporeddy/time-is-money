import type { Server } from 'socket.io';
import type { ClientToServerEvents, Round, ServerToClientEvents, TimeRefundConfig } from 'shared';
import { computeScores, getTemplate, rollItemInstance } from 'shared';
import { emitRoomState } from './rooms.js';
import type { Room } from './rooms.js';
import { scheduleBotEntries, scheduleBotReleases } from './bots.js';

type IO = Server<ClientToServerEvents, ServerToClientEvents>;

let roundCounter = 0;

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

  const item = rollItemInstance();
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
  };

  emitRoundStart(room, io);
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

  // A player's spent time is private until the final result.
  io.to(playerId).emit('bidder_dropped', { roundId: ar.round.id, playerId, committedMs: elapsed });
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

  const template = getTemplate(ar.item.templateId);

  // The highest amount any already-folded bidder paid this round — the
  // "runner-up" price. Second-price-rebate items only charge the winner up
  // to this, refunding the rest as time (uncontested wins already cost
  // almost nothing; this covers the contested case too).
  const secondPrice = Math.max(
    0,
    ...Object.values(ar.round.bidders)
      .filter((b) => b.droppedAt !== null)
      .map((b) => b.committedMs)
  );

  // Whoever is still mid-hold at resolution (normally just the winner, but
  // possibly several in a max-duration stalemate) has to pay for that time
  // now — resolving doesn't happen via their own release, so nothing else
  // deducts it.
  const now = Date.now();
  for (const [playerId, startedAt] of [...ar.holdStartedAt]) {
    const bidder = ar.round.bidders[playerId];
    const player = room.players.get(playerId);
    if (!bidder || !player) continue;

    const isWinner = playerId === winnerId;
    const rawElapsed = now - startedAt;
    const netElapsed = isWinner && template?.secondPriceRebate ? Math.min(rawElapsed, secondPrice) : rawElapsed;

    player.timeRemainingMs = Math.max(0, player.timeRemainingMs - netElapsed);
    if (player.timeRemainingMs <= 0) {
      player.timeRemainingMs = 0;
      player.status = 'out_of_time';
    }

    bidder.isHolding = false;
    bidder.committedMs = netElapsed;
    bidder.droppedAt = now;
    ar.holdStartedAt.delete(playerId);

    if (isWinner) room.itemPricePaidMs.set(ar.item.id, netElapsed);
  }

  ar.round.status = 'resolved';
  ar.round.winnerId = winnerId;

  if (winnerId) {
    const winner = room.players.get(winnerId);
    if (winner) {
      winner.stash.push(ar.item.id);
      room.wonItems.set(ar.item.id, ar.item);

      if (!room.itemPricePaidMs.has(ar.item.id)) {
        room.itemPricePaidMs.set(ar.item.id, ar.round.bidders[winnerId]?.committedMs ?? 0);
      }

      if (template?.effectType === 'timeRefund' && template.timeRefund) {
        const refund = computeTimeRefund(template.timeRefund, winner.timeRemainingMs, room.settings.startingTimeMs);
        if (refund > 0) {
          winner.timeRemainingMs += refund;
          if (winner.status === 'out_of_time') winner.status = 'active';
        }
      }
    }
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
  }

  room.status = 'lobby';
  room.currentRoundIndex = -1;
  room.activeRound = null;
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

function emitRoundStart(room: Room, io: IO) {
  const ar = room.activeRound;
  if (!ar) return;
  const { trueValue: _trueValue, hiddenTraitId: _hiddenTraitId, ...publicItem } = ar.item;
  io.emit('round_start', { round: ar.round, item: publicItem });
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

  // A player sees only their own live clock and spend. This avoids exposing
  // other players' remaining time or committed time.
  for (const socketId of io.sockets.sockets.keys()) {
    const ownTime = players[socketId];
    const ownBid = bidders[socketId];
    io.to(socketId).emit('round_tick', {
      players: ownTime === undefined ? {} : { [socketId]: ownTime },
      bidders: ownBid === undefined ? {} : { [socketId]: ownBid },
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
