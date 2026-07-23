import type { Server } from 'socket.io';
import type { ClientToServerEvents, Round, ServerToClientEvents, TimeRefundConfig } from 'shared';
import { computeScores, getTemplate, rollItemInstance } from 'shared';
import { toRoomState } from './rooms.js';
import type { Room } from './rooms.js';

type IO = Server<ClientToServerEvents, ServerToClientEvents>;

let roundCounter = 0;

export function startGame(room: Room, io: IO) {
  if (room.status !== 'lobby') return;
  room.status = 'in_round';
  startRound(room, io);
}

export function startRound(room: Room, io: IO) {
  const eligible = [...room.players.values()].filter((p) => p.status === 'active');

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
    noBidTimer: null,
    maxDurationTimer: null,
    interRoundTimer: null,
  };

  emitRoundStart(room, io);
  io.emit('room_state', toRoomState(room));

  setTimeout(() => activateRound(room, io), room.settings.pendingDurationMs);
}

function activateRound(room: Room, io: IO) {
  const ar = room.activeRound;
  if (!ar || ar.round.status !== 'pending') return;

  ar.round.status = 'active';
  emitRoundStart(room, io);

  ar.noBidTimer = setTimeout(() => {
    if (!ar.hasAnyoneHeld) resolveRound(room, io, null);
  }, room.settings.noBidTimeoutMs);

  ar.maxDurationTimer = setTimeout(() => {
    const stillHolding = Object.entries(ar.round.bidders).filter(([, b]) => b.isHolding);
    if (stillHolding.length === 0) return; // already resolved via checkResolution

    const now = Date.now();
    const [winnerId] = stillHolding.reduce((best, current) => {
      const bestElapsed = now - (ar.holdStartedAt.get(best[0]) ?? now);
      const currentElapsed = now - (ar.holdStartedAt.get(current[0]) ?? now);
      return currentElapsed > bestElapsed ? current : best;
    });
    resolveRound(room, io, winnerId);
  }, room.settings.maxRoundDurationMs);
}

export function handleHoldStart(room: Room, playerId: string, io: IO) {
  const ar = room.activeRound;
  if (!ar || ar.round.status !== 'active') return;

  const bidder = ar.round.bidders[playerId];
  const player = room.players.get(playerId);
  if (!bidder || !player) return;
  if (bidder.isHolding || bidder.droppedAt !== null) return; // already holding, or folded already this round
  if (player.status !== 'active' || player.timeRemainingMs <= 0) return;

  bidder.isHolding = true;
  ar.holdStartedAt.set(playerId, Date.now());

  if (!ar.hasAnyoneHeld) {
    ar.hasAnyoneHeld = true;
    if (ar.noBidTimer) {
      clearTimeout(ar.noBidTimer);
      ar.noBidTimer = null;
    }
  }

  // Covers the uncontested case: if everyone else has already folded (or
  // never held), starting a hold immediately makes you the sole holder —
  // that has to resolve right here, since nothing else will ever trigger it.
  checkResolution(room, io);
}

export function handleHoldRelease(room: Room, playerId: string, io: IO) {
  const ar = room.activeRound;
  if (!ar) return;

  const bidder = ar.round.bidders[playerId];
  const player = room.players.get(playerId);
  const startedAt = ar.holdStartedAt.get(playerId);
  if (!bidder || !player || !bidder.isHolding || startedAt === undefined) return;

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

  io.emit('bidder_dropped', { roundId: ar.round.id, playerId, committedMs: elapsed });
  io.emit('room_state', toRoomState(room));

  checkResolution(room, io);
}

function checkResolution(room: Room, io: IO) {
  const ar = room.activeRound;
  if (!ar || ar.round.status !== 'active') return;

  const stillHolding = Object.entries(ar.round.bidders).filter(([, b]) => b.isHolding);

  if (stillHolding.length === 1 && ar.hasAnyoneHeld) {
    resolveRound(room, io, stillHolding[0][0]);
  } else if (stillHolding.length === 0 && ar.hasAnyoneHeld) {
    resolveRound(room, io, null);
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

  io.emit('round_end', { round: ar.round, item: ar.item });
  io.emit('room_state', toRoomState(room));

  ar.interRoundTimer = setTimeout(() => {
    room.activeRound = null;
    const stillPlaying = [...room.players.values()].some((p) => p.status === 'active');
    if (stillPlaying) startRound(room, io);
    else finishGame(room, io);
  }, room.settings.interRoundDelayMs);
}

function finishGame(room: Room, io: IO) {
  room.status = 'game_over';
  room.activeRound = null;
  io.emit('room_state', toRoomState(room));

  const players = [...room.players.values()];
  const scores = computeScores(players, room.wonItems, room.itemPricePaidMs);
  io.emit('game_over', { players, scores });
}

export function restartGame(room: Room, io: IO) {
  if (room.status !== 'game_over') return;

  room.status = 'lobby';
  room.currentRoundIndex = -1;
  room.activeRound = null;
  room.wonItems.clear();
  room.itemPricePaidMs.clear();

  for (const player of room.players.values()) {
    player.timeRemainingMs = room.settings.startingTimeMs;
    player.status = 'active';
    player.stash = [];
  }

  io.emit('room_state', toRoomState(room));
}

function emitRoundStart(room: Room, io: IO) {
  const ar = room.activeRound;
  if (!ar) return;
  const { trueValue: _trueValue, hiddenTraitId: _hiddenTraitId, ...publicItem } = ar.item;
  io.emit('round_start', { round: ar.round, item: publicItem });
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

  io.emit('round_tick', { players, bidders });

  // Force-release anyone who has run out of time while holding.
  for (const [playerId, startedAt] of [...ar.holdStartedAt]) {
    const player = room.players.get(playerId);
    if (player && player.timeRemainingMs - (now - startedAt) <= 0) {
      handleHoldRelease(room, playerId, io);
    }
  }
}
