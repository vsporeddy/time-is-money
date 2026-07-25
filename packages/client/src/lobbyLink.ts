import { normalizeRoomCode } from 'shared';

// The lobby code lives in the URL hash rather than a query param. Both survive
// GitHub Pages (only extra *path* segments 404 without an SPA fallback), but
// the hash is writable without the History API, is never sent to the server,
// and still works inside a sandboxed iframe.

export function readLobbyCodeFromUrl(): string | null {
  // Tolerates '#ABCD', '#/ABCD' and '#lobby=ABCD' — links get mangled in chat apps.
  const raw = window.location.hash.replace(/^#/, '').replace(/^lobby=/i, '');
  return raw ? normalizeRoomCode(raw) : null;
}

// Always replaceState, never pushState: the code must not create a history
// entry, so Back leaves the site instead of dropping the player into a stale
// half-joined state. Falls back to assigning the hash directly for iframes
// where the History API is blocked (opaque origin throws SecurityError).
export function writeLobbyCodeToUrl(code: string) {
  const target = `${window.location.pathname}${window.location.search}#${code}`;
  try {
    window.history.replaceState(null, '', target);
  } catch {
    window.location.hash = code;
  }
}

export function clearLobbyCodeFromUrl() {
  try {
    // Setting location.hash = '' would leave a trailing '#' behind.
    window.history.replaceState(null, '', `${window.location.pathname}${window.location.search}`);
  } catch {
    window.location.hash = '';
  }
}

// Returns null when there is no URL worth sharing, so callers fall back to
// sharing the bare code. Which builds get which is a deploy-time decision:
// VITE_INVITE_MODE is 'link' for GitHub Pages and 'code' for itch.io, where
// `location` is the raw asset host (html-classic.itch.zone/html/<build-id>/)
// rather than a page anyone can visit — and itch doesn't forward the parent
// page's hash into the frame anyway. With the flag unset (plain dev builds),
// fall back to detecting whether we're framed.
export function buildInviteLink(code: string): string | null {
  const mode = import.meta.env.VITE_INVITE_MODE;
  if (mode === 'code') return null;

  if (mode !== 'link') {
    try {
      if (window.top !== window.self) return null;
    } catch {
      return null; // cross-origin frame — same conclusion
    }
  }

  return `${window.location.origin}${window.location.pathname}#${code}`;
}

// navigator.clipboard needs a secure context and can be blocked by an iframe's
// permissions policy, so fall back to selecting a real on-screen input and
// using the deprecated execCommand — the only thing that works over plain-HTTP
// LAN dev. Returns false if both routes fail, so the UI can tell the user to
// copy manually.
export async function copyText(text: string, fallbackEl?: HTMLInputElement | null): Promise<boolean> {
  if (window.isSecureContext && navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch {
      // fall through
    }
  }

  if (!fallbackEl) return false;
  try {
    fallbackEl.focus();
    fallbackEl.select();
    fallbackEl.setSelectionRange(0, 99999); // iOS ignores select() alone
    return document.execCommand('copy');
  } catch {
    return false;
  }
}
