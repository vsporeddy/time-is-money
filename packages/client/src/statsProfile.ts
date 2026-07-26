// The player's lifetime stats live here, on their own machine, as a token the
// server signed. We hand it back on every join; the server checks the signature,
// folds each finished game into it, and returns a fresh one.
//
// Nothing here verifies anything. The signature exists so the *server* can tell
// its own token from an edited one, and the server is the only thing that acts
// on the answer — a token it rejects means that player starts a fresh profile.
// What we decode below is display only, which is also why the payload is plain
// JSON: a player can read exactly what was recorded about them.

import { decodePayload, isWellFormed, STATS_TOKEN_VERSION } from 'shared';
import type { StatsToken } from 'shared';

const STORAGE_KEY = 'time-is-money:stats-profile';

export function loadStatsToken(): string | null {
  try {
    return window.localStorage.getItem(STORAGE_KEY);
  } catch {
    return null; // private mode / storage disabled — the player just gets no history
  }
}

export function saveStatsToken(token: string) {
  try {
    window.localStorage.setItem(STORAGE_KEY, token);
  } catch {
    // Stats are a nicety; failing to persist them must not break the game.
  }
}

/**
 * Reads a stored token for display. Returns null for anything we can't make
 * sense of, so a corrupted or hand-edited blob shows as no record rather than
 * as garbage numbers — the server reaches the same conclusion independently
 * when the token is presented on join.
 */
export function decodeStatsToken(raw: string): StatsToken | null {
  const parts = raw.split('.');
  if (parts.length !== 3 || parts[0] !== STATS_TOKEN_VERSION) return null;

  try {
    const token = decodePayload(parts[1]);
    return isWellFormed(token) ? token : null;
  } catch {
    return null;
  }
}
