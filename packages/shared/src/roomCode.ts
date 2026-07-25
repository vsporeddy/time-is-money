// Lobby codes. Shared so the client can normalize a pasted/linked code before
// sending it and the server can validate what it receives.
//
// The alphabet drops every vowel (and Y), so a generated code can never spell
// something unfortunate without needing a blocklist. It also drops the
// look-alikes 0/O and 1/I so a code read aloud or copied by hand survives.
//
// NOTE: 28^4 is only ~615k codes. Treat a lobby code as *unlisted*, not secret —
// it keeps strangers from stumbling in, it is not access control.
export const ROOM_CODE_ALPHABET = '23456789BCDFGHJKLMNPQRSTVWXZ';
export const ROOM_CODE_LENGTH = 4;

const ROOM_CODE_PATTERN = new RegExp(`^[${ROOM_CODE_ALPHABET}]{${ROOM_CODE_LENGTH},${ROOM_CODE_LENGTH + 1}}$`);

export function isValidRoomCode(code: string): boolean {
  return ROOM_CODE_PATTERN.test(code);
}

// Accepts anything a human might paste — surrounding whitespace, lowercase,
// a leading '#' or '/' from a mangled link — and returns the canonical code,
// or null if what's left isn't one.
export function normalizeRoomCode(raw: string): string | null {
  const cleaned = raw.trim().replace(/^[#/]+/, '').trim().toUpperCase();
  return isValidRoomCode(cleaned) ? cleaned : null;
}
