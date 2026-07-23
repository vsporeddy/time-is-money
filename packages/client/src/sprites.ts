// Sprite sheet is a 32x32 grid, 16 columns wide (measured from sprites.png).
export const SPRITE_SIZE = 32;
export const SHEET_COLUMNS = 16;

export function getSpriteSourceRect(index: number) {
  const col = index % SHEET_COLUMNS;
  const row = Math.floor(index / SHEET_COLUMNS);
  return { x: col * SPRITE_SIZE, y: row * SPRITE_SIZE, size: SPRITE_SIZE };
}
