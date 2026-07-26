// Collection/synergy traits — think TFT traits. Each is either matched against
// an item's static template tags (category traits, nested/overlapping) or
// against the material rolled onto the specific instance (modifier-driven
// traits, which cut across categories). Both are counted the same way at
// scoring time: highest tier whose count threshold is met, wins.

export interface TraitTier {
  count: number;
  bonus: number;
  multiplier?: number;
  bonusPerMatchingItem?: number;
  matchingItemMultiplier?: number;
  strongestMatchingItemMultiplier?: number;
}

export interface TraitDefinition {
  id: string;
  name: string;
  iconSpriteId: string;
  tiers: TraitTier[]; // ascending by count
  materialMatch?: string; // if set, counts instances with this rolled material instead of template.traits
  noSetBonus?: boolean;
}

export const TRAIT_DEFINITIONS: TraitDefinition[] = [
  { id: 'armor', name: 'Armor', iconSpriteId: '97', tiers: [{ count: 3, bonus: 0, strongestMatchingItemMultiplier: 1.5 }] },
  { id: 'trinket', name: 'Trinket', iconSpriteId: '133', tiers: [], noSetBonus: true },
  { id: 'weapon', name: 'Weapon', iconSpriteId: '80', tiers: [], noSetBonus: true },
  { id: 'text', name: 'Text', iconSpriteId: '217', tiers: [{ count: 2, bonus: 10 }, { count: 4, bonus: 25 }] },
  { id: 'musical', name: 'Musical', iconSpriteId: '179', tiers: [{ count: 2, bonus: 0, bonusPerMatchingItem: 10 }, { count: 3, bonus: 0, bonusPerMatchingItem: 15 }, { count: 4, bonus: 0, bonusPerMatchingItem: 20 }] },
  { id: 'aquatic', name: 'Aquatic', iconSpriteId: '262', tiers: [{ count: 2, bonus: 0, matchingItemMultiplier: 1.5 }, { count: 4, bonus: 0, matchingItemMultiplier: 2 }] },
  { id: 'cursed', name: 'Cursed', iconSpriteId: '0', tiers: [{ count: 3, bonus: 0, multiplier: 1.25 }], materialMatch: 'Cursed' },
  { id: 'magic', name: 'Magic', iconSpriteId: '103', tiers: [{ count: 3, bonus: 20 }, { count: 5, bonus: 40 }, { count: 7, bonus: 75 }] },
];

export function getTraitDefinition(id: string): TraitDefinition | undefined {
  return TRAIT_DEFINITIONS.find((t) => t.id === id);
}

// Base material rolls are independent from the optional Blessed/Cursed overlay.
export const MATERIAL_POOL = ['Used', 'Damaged', 'Mint'];

// Hidden traits: a per-instance secret, like trueValue — not shown during
// bidding, revealed only at round_end. Flat bonus/penalty, not a collection set.
export interface HiddenTraitDefinition {
  id: string;
  name: string;
  iconSpriteId: string;
  scoreBonus: number;
}

export const HIDDEN_TRAITS: HiddenTraitDefinition[] = [
  { id: 'windfall', name: 'Windfall', iconSpriteId: '5', scoreBonus: 25 },
  { id: 'flawed', name: 'Flawed', iconSpriteId: '0', scoreBonus: -20 },
  { id: 'sleeper', name: 'Sleeper', iconSpriteId: '6', scoreBonus: 15 },
];

export const HIDDEN_TRAIT_CHANCE = 0.12;

export function rollHiddenTrait(): string | undefined {
  if (Math.random() >= HIDDEN_TRAIT_CHANCE) return undefined;
  const pick = HIDDEN_TRAITS[Math.floor(Math.random() * HIDDEN_TRAITS.length)];
  return pick.id;
}

export function getHiddenTrait(id: string | undefined): HiddenTraitDefinition | undefined {
  if (!id) return undefined;
  return HIDDEN_TRAITS.find((t) => t.id === id);
}
