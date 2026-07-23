// portraits.png is a tightly-packed 13x13 grid, 128px cells, no gutters.
export const PORTRAIT_SIZE = 128;
export const PORTRAIT_COLUMNS = 13;
export const PORTRAIT_ROWS = 13;
export const PORTRAIT_COUNT = PORTRAIT_COLUMNS * PORTRAIT_ROWS;

export function randomPortraitIndex(): number {
  return Math.floor(Math.random() * PORTRAIT_COUNT);
}
