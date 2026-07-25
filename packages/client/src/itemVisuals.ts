import type { ItemTemplate } from 'shared';

export type ItemGlowCategory = 'weapon' | 'armor' | 'trinket' | 'text' | 'musical' | 'aquatic' | 'curio';

// Mirrors the server's weapon/main-trait/curio slot classification (round.ts
// buildLotPool) so an item's glow always matches which auction class it's in.
const MAIN_TRAIT_PRIORITY: ItemGlowCategory[] = ['armor', 'trinket', 'text', 'musical', 'aquatic'];

export const ITEM_GLOW_COLORS: Record<ItemGlowCategory, string> = {
  weapon: '#ff6b6b',
  armor: '#c9975f',
  trinket: '#ffdf7e',
  text: '#f2f2f2',
  musical: '#c9a0f5',
  aquatic: '#7ec8f2',
  curio: '#7ec850',
};

// Trait-badge text uses the same palette as the sprite glow it corresponds
// to. Traits with no category of their own (e.g. magic) fall back to the
// default attribute-set-label color.
export function getTraitLabelColor(traitId: string): string | undefined {
  return (ITEM_GLOW_COLORS as Record<string, string>)[traitId];
}

export function getItemGlowCategory(template: ItemTemplate | undefined): ItemGlowCategory {
  if (!template) return 'curio';
  if (template.weapon || template.effectType === 'weaponImmunity') return 'weapon';
  return MAIN_TRAIT_PRIORITY.find((trait) => template.traits.includes(trait)) ?? 'curio';
}

const RARITY_ORDER = ['Common', 'Rare', 'Legendary'];
const MATERIAL_ORDER = ['Damaged', 'Ordinary', 'Mint'];

// 0 (unknown, or Common/Ordinary baseline) to 1 (Legendary + Mint) — glows
// start dull and intensify as an item's rolled condition/rarity improve.
export function getGlowIntensity(material?: string, rarity?: string): number {
  const rarityScore = rarity ? Math.max(0, RARITY_ORDER.indexOf(rarity)) : 0;
  const materialScore = material ? Math.max(0, MATERIAL_ORDER.indexOf(material)) : 0;
  return (rarityScore + materialScore) / (RARITY_ORDER.length - 1 + MATERIAL_ORDER.length - 1);
}

function hexToRgb(hex: string): [number, number, number] {
  const value = parseInt(hex.slice(1), 16);
  return [(value >> 16) & 255, (value >> 8) & 255, value & 255];
}

function withAlpha(hex: string, alpha: number): string {
  const [r, g, b] = hexToRgb(hex);
  return `rgba(${r}, ${g}, ${b}, ${alpha.toFixed(2)})`;
}

// Two stacked drop-shadows: a tight glow that's always present at a dull
// baseline, plus a softer bloom that grows with intensity. drop-shadow (not
// box-shadow) so the glow follows the sprite's own pixel silhouette.
export function getGlowFilter(category: ItemGlowCategory, intensity: number): string {
  const color = ITEM_GLOW_COLORS[category];
  const innerBlur = 3 + intensity * 3;
  const innerAlpha = 0.55 + intensity * 0.35;
  const outerBlur = 8 + intensity * 10;
  const outerAlpha = 0.3 + intensity * 0.45;
  return `drop-shadow(0 0 ${innerBlur.toFixed(1)}px ${withAlpha(color, innerAlpha)}) drop-shadow(0 0 ${outerBlur.toFixed(1)}px ${withAlpha(color, outerAlpha)})`;
}
