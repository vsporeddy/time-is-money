// Server side of the client-held stats profile: verify what a player brings in,
// fold a finished game into it, hand back a re-signed token, and publish plain
// copies so the rest of the room can look each other up.
//
// Only the owner ever receives the signed token. The signature is there to
// survive the round trip through their localStorage, which we don't control;
// what other players see comes straight from this process over an already
// trusted socket, so it travels as plain data.

import type { Player, PlayerStats, ScoreBreakdown, StatsToken } from 'shared';
import { emptyStats, mergeGameResult, rankScores, STATS_TOKEN_TTL_MS } from 'shared';
import { randomUUID } from 'node:crypto';
import { activeKeyId, signStatsToken, verifyToken } from './statsKey.js';
import type { AppSocket, IO, Room } from './rooms.js';

/**
 * Verifies a token the client presented on join and stashes it on the socket.
 * A missing, expired, tampered or wrong-typed token is not an error: the player
 * simply starts a fresh profile at the end of their next game.
 */
export function attachStatsProfile(socket: AppSocket, rawToken: string | undefined, name: string) {
  if (!rawToken) return;

  const result = verifyToken(rawToken, Date.now());
  if (!result.ok) {
    console.warn(`[stats] rejected token from ${socket.id}: ${result.reason}`);
    return;
  }

  socket.data.statsProfile = { ...result.token, name };
}

/** The room's records, for the panels that let players look each other up. */
export function emitPlayerStats(room: Room, io: IO) {
  const entries: { playerId: string; stats: PlayerStats }[] = [];

  for (const player of room.players.values()) {
    if (player.isBot) continue;
    const profile = io.sockets.sockets.get(player.id)?.data.statsProfile;
    if (profile) entries.push({ playerId: player.id, stats: profile.stats });
  }

  io.to(room.code).emit('player_stats', { entries });
}

/**
 * Folds a finished game into each human player's profile and sends every one of
 * them their own re-signed bearer token. Called from finishGame, after scoring.
 *
 * The client's previous totals are only ever taken from a token we signed
 * ourselves, and this game's numbers come from server state, so a player cannot
 * inflate their stats — only delete or roll back their own token.
 */
export function recordGameResults(room: Room, io: IO, players: Player[], scores: ScoreBreakdown[]) {
  const now = Date.now();
  const ranked = rankScores(scores, players);

  for (const player of players) {
    if (player.isBot) continue;
    const socket = io.sockets.sockets.get(player.id);
    if (!socket) continue; // disconnected before game over — this game goes unrecorded

    const entry = ranked.find((r) => r.score.playerId === player.id);
    if (!entry) continue;

    // Only lots bought at auction have a price entry; chest/effect items don't.
    const wonLots = player.stash.filter((itemId) => room.itemPricePaidMs.has(itemId));
    const timeSpentMs = wonLots.reduce((sum, itemId) => sum + (room.itemPricePaidMs.get(itemId) ?? 0), 0);

    const previous = socket.data.statsProfile;
    const profile: StatsToken = {
      v: 1,
      kid: activeKeyId(),
      pid: previous?.pid ?? randomUUID(),
      name: player.name,
      iat: now,
      exp: now + STATS_TOKEN_TTL_MS,
      stats: mergeGameResult(previous?.stats ?? emptyStats(now), {
        score: entry.score.total,
        rank: entry.rank,
        classId: player.classId,
        lotsWon: wonLots.length,
        itemsCollected: player.stash.length,
        timeSpentMs,
        timeRemainingMs: player.timeRemainingMs,
        outOfTime: player.status === 'out_of_time',
        at: now,
      }),
    };

    socket.data.statsProfile = profile;
    socket.emit('stats_token', { token: signStatsToken(profile) });
  }

  emitPlayerStats(room, io);
}
