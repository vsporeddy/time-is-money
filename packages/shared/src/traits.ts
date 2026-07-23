// Collection/synergy traits — think TFT traits. Each is either matched against
// an item's static template tags (category traits, nested/overlapping) or
// against the material rolled onto the specific instance (modifier-driven
// traits, which cut across categories). Both are counted the same way at
// scoring time: highest tier whose count threshold is met, wins.

export interface TraitTier {
  count: number;
  bonus: number;
}

export interface TraitDefinition {
  id: string;
  name: string;
  iconSpriteId: string;
  tiers: TraitTier[]; // ascending by count
  materialMatch?: string; // if set, counts instances with this rolled material instead of template.traits
}

export const TRAIT_DEFINITIONS: TraitDefinition[] = [
  // --- Broad categories (nested: a Sword counts for both "sword" and "weapon") ---
  { id: 'weapon', name: 'Weapon', iconSpriteId: '89', tiers: [{ count: 2, bonus: 20 }, { count: 4, bonus: 55 }] },
  { id: 'armor', name: 'Armor', iconSpriteId: '97', tiers: [{ count: 2, bonus: 20 }, { count: 4, bonus: 55 }] },
  { id: 'trinket', name: 'Trinket', iconSpriteId: '133', tiers: [{ count: 2, bonus: 20 }, { count: 3, bonus: 50 }] },
  { id: 'tool', name: 'Tool', iconSpriteId: '162', tiers: [{ count: 2, bonus: 20 }, { count: 4, bonus: 55 }] },
  { id: 'musical', name: 'Musical', iconSpriteId: '179', tiers: [{ count: 2, bonus: 25 }, { count: 3, bonus: 55 }] },
  { id: 'text', name: 'Text', iconSpriteId: '217', tiers: [{ count: 2, bonus: 20 }, { count: 3, bonus: 45 }] },
  { id: 'food', name: 'Food', iconSpriteId: '224', tiers: [{ count: 3, bonus: 25 }, { count: 5, bonus: 60 }] },
  { id: 'aquatic', name: 'Aquatic', iconSpriteId: '262', tiers: [{ count: 2, bonus: 20 }, { count: 3, bonus: 50 }] },

  // --- Narrow sub-traits (nested inside a broad category above) ---
  { id: 'sword', name: 'Sword', iconSpriteId: '84', tiers: [{ count: 2, bonus: 20 }, { count: 3, bonus: 45 }] },
  { id: 'bow', name: 'Bow', iconSpriteId: '99', tiers: [{ count: 2, bonus: 25 }] },
  { id: 'staff', name: 'Staff', iconSpriteId: '105', tiers: [{ count: 2, bonus: 25 }] },
  { id: 'book', name: 'Book', iconSpriteId: '213', tiers: [{ count: 2, bonus: 20 }, { count: 3, bonus: 45 }] },
  { id: 'dessert', name: 'Dessert', iconSpriteId: '253', tiers: [{ count: 2, bonus: 20 }] },

  // --- Modifier-driven (matches rolled material, cuts across every category) ---
  { id: 'cursed', name: 'Cursed', iconSpriteId: '0', tiers: [{ count: 2, bonus: 20 }, { count: 3, bonus: 45 }], materialMatch: 'Cursed' },
  { id: 'blessed', name: 'Blessed', iconSpriteId: '5', tiers: [{ count: 2, bonus: 20 }, { count: 3, bonus: 45 }], materialMatch: 'Blessed' },
];

export function getTraitDefinition(id: string): TraitDefinition | undefined {
  return TRAIT_DEFINITIONS.find((t) => t.id === id);
}

// Shared material pool — every template draws from this so "Cursed"/"Blessed"
// can land on anything (a weapon, a snack, a trinket), not just one category.
export const MATERIAL_POOL = ['Ordinary', 'Weathered', 'Pristine', 'Cursed', 'Blessed'];

// Hidden traits: a per-instance secret, like trueValue — not shown during
// bidding, revealed only at round_end. Flat bonus/penalty, not a collection set.
export interface HiddenTraitDefinition {
  id: string;
  name: string;
  iconSpriteId: string;
  scoreBonus: number;
}

export const HIDDEN_TRAITS: HiddenTraitDefinition[] = [
  { id: 'blessed-find', name: 'Blessed Find', iconSpriteId: '5', scoreBonus: 25 },
  { id: 'cursed-find', name: 'Cursed Find', iconSpriteId: '0', scoreBonus: -20 },
  { id: 'lucky-find', name: 'Lucky Find', iconSpriteId: '6', scoreBonus: 15 },
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
