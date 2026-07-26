const NAME_KEY = 'time-is-money:player-name';
const EARNINGS_KEY = 'time-is-money:total-earnings';

export function loadPlayerName(): string {
  try {
    return window.localStorage.getItem(NAME_KEY) ?? '';
  } catch {
    return '';
  }
}

export function savePlayerName(name: string) {
  try {
    window.localStorage.setItem(NAME_KEY, name);
  } catch {
    // Name entry should still work when storage is unavailable.
  }
}

export function loadTotalEarnings(): number {
  try {
    const saved = Number(window.localStorage.getItem(EARNINGS_KEY));
    return Number.isFinite(saved) ? saved : 0;
  } catch {
    return 0;
  }
}

// Returns the new running total so callers can update state without a second read.
export function addTotalEarnings(amount: number): number {
  const next = loadTotalEarnings() + amount;
  try {
    window.localStorage.setItem(EARNINGS_KEY, String(next));
  } catch {
    // Earnings tracking is best-effort when storage is unavailable.
  }
  return next;
}
