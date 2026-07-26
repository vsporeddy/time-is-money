// Lifetime player statistics that live on the player's machine, not ours.
//
// The server keeps no database. Instead it signs a small plaintext JSON payload
// and hands it to the client, which stores it and presents it back on the next
// join. The payload is deliberately readable — a player can decode their own
// token and see exactly what we recorded — but only the server can produce a
// valid tag, so the numbers can't be inflated. The server signs and the server
// verifies; the client never checks the tag, it just carries the token.
//
// Format: `v1.<base64url(payload json)>.<base64url(hmac-sha256 tag)>`
// The tag covers the raw ASCII of the middle segment.

export const STATS_TOKEN_VERSION = 'v1';
export const STATS_TOKEN_TTL_MS = 365 * 24 * 60 * 60 * 1000;
// Tolerance for a client whose clock runs ahead of the signing server.
export const STATS_TOKEN_CLOCK_SKEW_MS = 60_000;

export interface PlayerStats {
  gamesFinished: number;
  wins: number; // finished at rank 1 (shared ranks all count)
  podiums: number; // rank 1-3
  bestScore: number;
  totalScore: number;
  lotsWon: number; // lots taken at auction, excluding items gained from chests/effects
  itemsCollected: number; // final stash size, however the items were acquired
  timeSpentMs: number; // time actually paid for won lots
  timeRemainingMs: number; // time still on the clock at game over, summed
  outOfTimeCount: number;
  classGames: Record<string, number>;
  classWins: Record<string, number>;
  firstSeenAt: number;
  lastPlayedAt: number;
}

// A token is only ever sent to the player it belongs to. What other players see
// of someone's record is plain data from the server over the same socket that
// already carries room state and scores.
export interface StatsToken {
  v: 1;
  kid: string; // which secret signed this token, so a rotation can still verify it
  pid: string; // profile id, minted server-side on the first signature
  name: string; // last display name this profile played under
  iat: number; // issued at, ms epoch
  exp: number; // rolls forward on every re-sign
  stats: PlayerStats;
}

export interface GameResultInput {
  score: number;
  rank: number;
  classId: string;
  lotsWon: number;
  itemsCollected: number;
  timeSpentMs: number;
  timeRemainingMs: number;
  outOfTime: boolean;
  at: number;
}

export function emptyStats(now: number): PlayerStats {
  return {
    gamesFinished: 0,
    wins: 0,
    podiums: 0,
    bestScore: 0,
    totalScore: 0,
    lotsWon: 0,
    itemsCollected: 0,
    timeSpentMs: 0,
    timeRemainingMs: 0,
    outOfTimeCount: 0,
    classGames: {},
    classWins: {},
    firstSeenAt: now,
    lastPlayedAt: now,
  };
}

export function mergeGameResult(stats: PlayerStats, result: GameResultInput): PlayerStats {
  const won = result.rank === 1;
  return {
    gamesFinished: stats.gamesFinished + 1,
    wins: stats.wins + (won ? 1 : 0),
    podiums: stats.podiums + (result.rank <= 3 ? 1 : 0),
    bestScore: Math.max(stats.bestScore, result.score),
    totalScore: stats.totalScore + result.score,
    lotsWon: stats.lotsWon + result.lotsWon,
    itemsCollected: stats.itemsCollected + result.itemsCollected,
    timeSpentMs: stats.timeSpentMs + result.timeSpentMs,
    timeRemainingMs: stats.timeRemainingMs + result.timeRemainingMs,
    outOfTimeCount: stats.outOfTimeCount + (result.outOfTime ? 1 : 0),
    classGames: bump(stats.classGames, result.classId, 1),
    classWins: won ? bump(stats.classWins, result.classId, 1) : { ...stats.classWins },
    firstSeenAt: stats.firstSeenAt,
    lastPlayedAt: result.at,
  };
}

function bump(counts: Record<string, number>, key: string, by: number): Record<string, number> {
  return { ...counts, [key]: (counts[key] ?? 0) + by };
}

// --- Encoding ---

export function toBase64Url(bytes: Uint8Array): string {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export function fromBase64Url(value: string): Uint8Array {
  const base64 = value.replace(/-/g, '+').replace(/_/g, '/');
  const padded = base64 + '='.repeat((4 - (base64.length % 4)) % 4);
  const binary = atob(padded);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

export function encodePayload(token: StatsToken): string {
  return toBase64Url(new TextEncoder().encode(JSON.stringify(token)));
}

export function decodePayload(segment: string): StatsToken {
  return JSON.parse(new TextDecoder().decode(fromBase64Url(segment))) as StatsToken;
}

export function buildToken(payloadSegment: string, tag: Uint8Array): string {
  return `${STATS_TOKEN_VERSION}.${payloadSegment}.${toBase64Url(tag)}`;
}

export function splitToken(raw: string): { payloadSegment: string; tagSegment: string } | null {
  const parts = raw.split('.');
  if (parts.length !== 3 || parts[0] !== STATS_TOKEN_VERSION) return null;
  return { payloadSegment: parts[1], tagSegment: parts[2] };
}

/**
 * Shape check for a decoded payload. Rejects negative/non-finite counters so a
 * hand-edited token can't smuggle NaN into arithmetic even when it is unsigned
 * and only being displayed.
 */
export function isWellFormed(token: unknown): token is StatsToken {
  if (!token || typeof token !== 'object') return false;
  const t = token as Partial<StatsToken>;
  if (t.v !== 1) return false;
  if (typeof t.kid !== 'string' || typeof t.pid !== 'string' || typeof t.name !== 'string') return false;
  if (!Number.isFinite(t.iat) || !Number.isFinite(t.exp)) return false;
  const stats = t.stats as Partial<PlayerStats> | undefined;
  if (!stats || typeof stats !== 'object') return false;

  const counters: (keyof PlayerStats)[] = [
    'gamesFinished',
    'wins',
    'podiums',
    'bestScore',
    'totalScore',
    'lotsWon',
    'itemsCollected',
    'timeSpentMs',
    'timeRemainingMs',
    'outOfTimeCount',
    'firstSeenAt',
    'lastPlayedAt',
  ];
  for (const key of counters) {
    const value = stats[key];
    if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) return false;
  }
  return isCountMap(stats.classGames) && isCountMap(stats.classWins);
}

function isCountMap(value: unknown): value is Record<string, number> {
  if (!value || typeof value !== 'object') return false;
  return Object.values(value as Record<string, unknown>).every(
    (count) => typeof count === 'number' && Number.isFinite(count) && count >= 0
  );
}
