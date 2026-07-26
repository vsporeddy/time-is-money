export interface PanelOffset {
  x: number;
  y: number;
}

const STORAGE_KEY = 'time-is-money:panel-positions';

function loadAll(): Record<string, PanelOffset> {
  try {
    const saved = window.localStorage.getItem(STORAGE_KEY);
    if (!saved) return {};

    const parsed = JSON.parse(saved) as Record<string, Partial<PanelOffset>>;
    if (!parsed || typeof parsed !== 'object') return {};

    const offsets: Record<string, PanelOffset> = {};
    for (const [key, offset] of Object.entries(parsed)) {
      if (Number.isFinite(offset?.x) && Number.isFinite(offset?.y)) {
        offsets[key] = { x: offset!.x as number, y: offset!.y as number };
      }
    }
    return offsets;
  } catch {
    return {};
  }
}

/** Null when the panel has never been dragged, so callers can fall back to their own default. */
export function loadPanelOffset(key: string): PanelOffset | null {
  return loadAll()[key] ?? null;
}

export function savePanelOffset(key: string, offset: PanelOffset) {
  try {
    const offsets = loadAll();
    offsets[key] = offset;
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(offsets));
  } catch {
    // Panels should still drag when storage is unavailable, they just forget.
  }
}
