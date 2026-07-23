import type { Server } from 'socket.io';
import type { ClientToServerEvents, Round, ServerToClientEvents } from 'shared';
import { rollItemInstance } from 'shared';
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
  io.to(room.code).emit('room_state', toRoomState(room));

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

  io.to(room.code).emit('bidder_dropped', { roundId: ar.round.id, playerId, committedMs: elapsed });
  io.to(room.code).emit('room_state', toRoomState(room));

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

  // Whoever is still mid-hold at resolution (normally just the winner, but
  // possibly several in a max-duration stalemate) has to pay for that time
  // now — resolving doesn't happen via their own release, so nothing else
  // deducts it.
  const now = Date.now();
  for (const [playerId, startedAt] of [...ar.holdStartedAt]) {
    const bidder = ar.round.bidders[playerId];
    const player = room.players.get(playerId);
    if (!bidder || !player) continue;

    const elapsed = now - startedAt;
    player.timeRemainingMs = Math.max(0, player.timeRemainingMs - elapsed);
    if (player.timeRemainingMs <= 0) {
      player.timeRemainingMs = 0;
      player.status = 'out_of_time';
    }

    bidder.isHolding = false;
    bidder.committedMs = elapsed;
    bidder.droppedAt = now;
    ar.holdStartedAt.delete(playerId);
  }

  ar.round.status = 'resolved';
  ar.round.winnerId = winnerId;

  if (winnerId) {
    const winner = room.players.get(winnerId);
    if (winner) {
      winner.stash.push(ar.item.id);
      room.wonItems.set(ar.item.id, ar.item);
    }
  }

  io.to(room.code).emit('round_end', { round: ar.round, item: ar.item });
  io.to(room.code).emit('room_state', toRoomState(room));

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
  io.to(room.code).emit('room_state', toRoomState(room));
  io.to(room.code).emit('game_over', { players: [...room.players.values()] });
}

function emitRoundStart(room: Room, io: IO) {
  const ar = room.activeRound;
  if (!ar) return;
  const { trueValue: _trueValue, ...publicItem } = ar.item;
  io.to(room.code).emit('round_start', { round: ar.round, item: publicItem });
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

  io.to(room.code).emit('round_tick', { players, bidders });

  // Force-release anyone who has run out of time while holding.
  for (const [playerId, startedAt] of [...ar.holdStartedAt]) {
    const player = room.players.get(playerId);
    if (player && player.timeRemainingMs - (now - startedAt) <= 0) {
      handleHoldRelease(room, playerId, io);
    }
  }
}
