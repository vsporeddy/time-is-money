// Signing for player stats tokens.
//
// The server is the only party that signs and the only party that verifies, so
// this is an HMAC over a shared secret rather than a public-key signature: the
// payload travels through the player's localStorage and comes back on join, and
// all we need to know is whether we were the ones who wrote it. A token that
// fails the check is discarded and that player starts a fresh profile.
//
// The payload itself stays plaintext JSON — a player can read exactly what we
// recorded about them. They just can't mint or edit one.

import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import {
  buildToken,
  decodePayload,
  encodePayload,
  fromBase64Url,
  isWellFormed,
  splitToken,
  STATS_TOKEN_CLOCK_SKEW_MS,
} from 'shared';
import type { StatsToken } from 'shared';

export type StatsTokenFailure =
  | 'malformed'
  | 'bad_payload'
  | 'unknown_key'
  | 'bad_tag'
  | 'expired';

export type StatsTokenResult = { ok: true; token: StatsToken } | { ok: false; reason: StatsTokenFailure };

const MIN_SECRET_BYTES = 16;

interface SigningKey {
  kid: string;
  secret: Buffer;
}

let activeKey: SigningKey;
const keysByKid = new Map<string, SigningKey>();

function decodeSecret(value: string): Buffer {
  const trimmed = value.trim();
  // Accept base64 (what the generator emits) but fall back to the raw string so
  // a hand-written passphrase still works.
  const decoded = Buffer.from(trimmed.replace(/-/g, '+').replace(/_/g, '/'), 'base64');
  return decoded.length >= MIN_SECRET_BYTES ? decoded : Buffer.from(trimmed, 'utf8');
}

/**
 * Identifies which secret signed a token, so a rotation can keep verifying the
 * previous one. Derived through HMAC rather than a bare hash of the secret, so
 * the id we publish inside every token isn't a direct digest of the key.
 */
function keyIdFor(secret: Buffer): string {
  return createHmac('sha256', secret).update('time-is-money:stats-kid').digest('hex').slice(0, 16);
}

function register(secret: Buffer): SigningKey {
  const key = { kid: keyIdFor(secret), secret };
  keysByKid.set(key.kid, key);
  return key;
}

function tagFor(secret: Buffer, payloadSegment: string): Buffer {
  return createHmac('sha256', secret).update(payloadSegment, 'ascii').digest();
}

export function initStatsKeys() {
  const configured = process.env.STATS_SIGNING_KEY;
  if (configured) {
    const secret = decodeSecret(configured);
    if (secret.length < MIN_SECRET_BYTES) {
      console.warn(
        `[stats] STATS_SIGNING_KEY is only ${secret.length} bytes — use scripts/generate-stats-key.mjs for a full-strength secret.`
      );
    }
    activeKey = register(secret);
  } else {
    // Deliberately random rather than a fixed fallback: a hardcoded default
    // secret that shipped to production would let anyone forge their own stats.
    // A per-boot secret fails closed instead — old tokens simply don't verify.
    activeKey = register(randomBytes(32));
    console.warn(
      '[stats] STATS_SIGNING_KEY is not set — using a random secret for this process. ' +
        'Every restart will invalidate all existing player stats tokens.'
    );
  }

  // Rotation: retired secrets keep verifying tokens they signed until those
  // players finish another game and get re-signed under the active secret.
  let legacyCount = 0;
  for (const entry of (process.env.STATS_LEGACY_KEYS ?? '').split(',')) {
    const trimmed = entry.trim();
    if (trimmed) {
      register(decodeSecret(trimmed));
      legacyCount += 1;
    }
  }

  // Enough to tell at a glance which secret a deployment picked up, without
  // putting a usable amount of it in the logs. The kid is derived from the
  // secret but doesn't reveal it, so match on that when you need certainty.
  const preview = (configured ?? '').slice(0, 4);
  console.log(
    `[stats] signing key ${configured ? `${preview}… ` : '(random) '}kid=${activeKey.kid}` +
      (legacyCount > 0 ? `, ${legacyCount} legacy key${legacyCount === 1 ? '' : 's'} still verifying` : '')
  );
}

export function activeKeyId(): string {
  return activeKey.kid;
}

export function signStatsToken(payload: Omit<StatsToken, 'kid'>): string {
  const segment = encodePayload({ ...payload, kid: activeKey.kid });
  return buildToken(segment, tagFor(activeKey.secret, segment));
}

/**
 * Decides whether a token the client presented is one we signed. Everything a
 * caller needs is in the result: `ok` means the stats inside can be built on,
 * anything else means treat that player as having no profile yet.
 */
export function verifyToken(raw: string, now: number): StatsTokenResult {
  const parts = splitToken(raw);
  if (!parts) return { ok: false, reason: 'malformed' };

  let token: StatsToken;
  let tag: Buffer;
  try {
    token = decodePayload(parts.payloadSegment);
    tag = Buffer.from(fromBase64Url(parts.tagSegment));
  } catch {
    return { ok: false, reason: 'malformed' };
  }

  if (!isWellFormed(token)) return { ok: false, reason: 'bad_payload' };

  const key = keysByKid.get(token.kid);
  if (!key) return { ok: false, reason: 'unknown_key' };

  const expected = tagFor(key.secret, parts.payloadSegment);
  if (expected.length !== tag.length || !timingSafeEqual(expected, tag)) return { ok: false, reason: 'bad_tag' };

  // Checked only after the tag, so an expiry we didn't sign can't be trusted.
  if (token.exp <= now || token.iat > now + STATS_TOKEN_CLOCK_SKEW_MS) return { ok: false, reason: 'expired' };

  return { ok: true, token };
}
