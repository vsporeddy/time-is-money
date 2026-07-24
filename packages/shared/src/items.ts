import type { ItemInstance, ItemTemplate } from './index.js';
import { MATERIAL_POOL, rollHiddenTrait } from './traits.js';

const RARITY_POOL = ['Common', 'Rare', 'Legendary'];
const WEIGHTED_RARITY_POOL = [
  { value: 'Common', weight: 70 },
  { value: 'Rare', weight: 20 },
  { value: 'Legendary', weight: 10 },
];
const WEIGHTED_MATERIAL_POOL = [
  { value: 'Ordinary', weight: 65 },
  { value: 'Weathered', weight: 25 },
  { value: 'Pristine', weight: 10 },
];

// Temporary playtest flag — set to false to restore normal Blessed/Cursed rolls.
const FORCE_CURSED_OVERLAY = false;

// baseSpriteId indices refer to the annotated sprites_reference.png grid
// (index = row * 16 + col, 0-indexed top-left). Starting trait/flag
// assignments below are a first pass — tune freely while playtesting.
export const ITEM_TEMPLATES: ItemTemplate[] = [
  // --- Weapons (broad trait: weapon) ---
  { id: 'rusty-sword', name: 'Rusty Sword', baseSpriteId: '80', valueRange: [15, 45], materials: MATERIAL_POOL, rarities: RARITY_POOL, effectType: 'none', traits: ['weapon', 'sword'] },
  { id: 'iron-sword', name: 'Iron Sword', baseSpriteId: '81', valueRange: [25, 65], materials: MATERIAL_POOL, rarities: RARITY_POOL, effectType: 'none', traits: ['weapon', 'sword'] },
  { id: 'ornate-sword', name: 'Ornate Sword', baseSpriteId: '84', valueRange: [50, 140], materials: MATERIAL_POOL, rarities: RARITY_POOL, effectType: 'none', traits: ['weapon', 'sword'] },
  { id: 'combat-dagger', name: 'Combat Dagger', baseSpriteId: '87', valueRange: [10, 35], materials: MATERIAL_POOL, rarities: RARITY_POOL, effectType: 'none', traits: ['weapon'] },
  { id: 'battle-axe', name: 'Battle Axe', baseSpriteId: '90', valueRange: [30, 80], materials: MATERIAL_POOL, rarities: RARITY_POOL, effectType: 'none', traits: ['weapon'] },
  { id: 'hunting-bow', name: 'Hunting Bow', baseSpriteId: '99', valueRange: [25, 70], materials: MATERIAL_POOL, rarities: RARITY_POOL, effectType: 'none', traits: ['weapon', 'bow'] },
  { id: 'crossbow', name: 'Crossbow', baseSpriteId: '100', valueRange: [35, 90], materials: MATERIAL_POOL, rarities: RARITY_POOL, effectType: 'none', traits: ['weapon', 'bow'] },
  { id: 'arcane-staff', name: 'Arcane Staff', baseSpriteId: '105', valueRange: [40, 120], materials: MATERIAL_POOL, rarities: RARITY_POOL, effectType: 'none', traits: ['weapon'] },
  { id: 'riot-shield', name: 'Riot Shield', baseSpriteId: '97', valueRange: [20, 55], materials: MATERIAL_POOL, rarities: RARITY_POOL, effectType: 'none', traits: ['weapon'] },

  // --- Armor (broad trait: armor) ---
  { id: 'horned-helm', name: 'Horned Helm', baseSpriteId: '115', valueRange: [30, 75], materials: MATERIAL_POOL, rarities: RARITY_POOL, effectType: 'none', traits: ['armor'] },
  { id: 'leather-vest', name: 'Leather Vest', baseSpriteId: '118', valueRange: [20, 55], materials: MATERIAL_POOL, rarities: RARITY_POOL, effectType: 'none', traits: ['armor'] },
  { id: 'plate-armor', name: 'Plate Armor', baseSpriteId: '119', valueRange: [35, 90], materials: MATERIAL_POOL, rarities: RARITY_POOL, effectType: 'none', traits: ['armor'] },
  { id: 'travelers-cuirass', name: "Traveler's Cuirass", baseSpriteId: '117', valueRange: [10, 30], materials: MATERIAL_POOL, rarities: RARITY_POOL, effectType: 'none', traits: ['armor'] },
  { id: 'worn-boots', name: 'Worn Boots', baseSpriteId: '130', valueRange: [8, 25], materials: MATERIAL_POOL, rarities: RARITY_POOL, effectType: 'none', traits: ['armor'] },
  { id: 'reinforced-gauntlet', name: 'Reinforced Gauntlet', baseSpriteId: '129', valueRange: [15, 40], materials: MATERIAL_POOL, rarities: RARITY_POOL, effectType: 'none', traits: ['armor'] },

  // --- Trinkets (broad trait: trinket) ---
  { id: 'gold-pendant', name: 'Gold Pendant', baseSpriteId: '134', valueRange: [20, 60], materials: MATERIAL_POOL, rarities: RARITY_POOL, effectType: 'none', traits: ['trinket'] },
  { id: 'diamond-ring', name: 'Diamond Ring', baseSpriteId: '133', valueRange: [40, 130], materials: MATERIAL_POOL, rarities: RARITY_POOL, effectType: 'none', traits: ['trinket'] },
  { id: 'bonetooth-necklace', name: 'Bonetooth Necklace', baseSpriteId: '136', valueRange: [35, 100], materials: MATERIAL_POOL, rarities: RARITY_POOL, effectType: 'none', traits: ['trinket'] },

  // --- Tools (broad trait: tool) ---
  { id: 'pickaxe', name: 'Pickaxe', baseSpriteId: '162', valueRange: [10, 30], materials: MATERIAL_POOL, rarities: RARITY_POOL, effectType: 'none', traits: ['tool'] },
  { id: 'rusted-lantern', name: 'Rusted Lantern', baseSpriteId: '169', valueRange: [8, 25], materials: MATERIAL_POOL, rarities: RARITY_POOL, effectType: 'timeRefund', timeRefund: { mode: 'catchup', amountMs: 15_000 }, traits: ['tool'] },
  // { id: 'signal-hourglass', name: 'Signal Hourglass', baseSpriteId: '175', valueRange: [15, 40], materials: MATERIAL_POOL, rarities: RARITY_POOL, effectType: 'timeRefund', timeRefund: { mode: 'flat', amountMs: 8_000 }, traits: ['tool'] },
  { id: 'apothecary-kit', name: 'Apothecary Kit', baseSpriteId: '188', valueRange: [12, 35], materials: MATERIAL_POOL, rarities: RARITY_POOL, effectType: 'none', traits: ['tool'] },
  { id: 'bear-trap', name: 'Bear Trap', baseSpriteId: '174', valueRange: [10, 28], materials: MATERIAL_POOL, rarities: RARITY_POOL, effectType: 'none', traits: ['tool'] },

  // --- Musical (broad trait: musical) ---
  { id: 'violin', name: 'Violin', baseSpriteId: '180', valueRange: [20, 60], materials: MATERIAL_POOL, rarities: RARITY_POOL, effectType: 'none', traits: ['musical'] },
  { id: 'pan-flute', name: 'Pan Flute', baseSpriteId: '183', valueRange: [15, 45], materials: MATERIAL_POOL, rarities: RARITY_POOL, effectType: 'none', traits: ['musical'] },

  // --- Text (broad trait: text, narrow: book) ---
  { id: 'ancient-tome', name: 'Ancient Tome', baseSpriteId: '213', valueRange: [20, 70], materials: MATERIAL_POOL, rarities: RARITY_POOL, effectType: 'none', traits: ['text', 'book'] },
  { id: 'leather-journal', name: 'Leather Journal', baseSpriteId: '210', valueRange: [10, 35], materials: MATERIAL_POOL, rarities: RARITY_POOL, effectType: 'none', traits: ['text', 'book'] },
  { id: 'sealed-scroll', name: 'Sealed Scroll', baseSpriteId: '220', valueRange: [0, 90], materials: MATERIAL_POOL, rarities: RARITY_POOL, effectType: 'none', traits: ['text'] },
  { id: 'love-letter', name: 'Love Letter', baseSpriteId: '218', valueRange: [5, 25], materials: MATERIAL_POOL, rarities: RARITY_POOL, effectType: 'none', traits: ['text'] },

  // --- Food (broad trait: food, narrow: dessert) ---
  { id: 'fresh-apple', name: 'Fresh Apple', baseSpriteId: '224', valueRange: [3, 12], materials: MATERIAL_POOL, rarities: RARITY_POOL, effectType: 'none', traits: ['food'] },
  { id: 'stale-bread', name: 'Stale Bread', baseSpriteId: '237', valueRange: [3, 10], materials: MATERIAL_POOL, rarities: RARITY_POOL, effectType: 'none', traits: ['food'] },
  { id: 'aged-cheese', name: 'Aged Cheese', baseSpriteId: '247', valueRange: [8, 20], materials: MATERIAL_POOL, rarities: RARITY_POOL, effectType: 'none', traits: ['food'] },
  { id: 'chocolate-cake', name: 'Chocolate Cake', baseSpriteId: '253', valueRange: [10, 30], materials: MATERIAL_POOL, rarities: RARITY_POOL, effectType: 'none', traits: ['food', 'dessert'] },
  { id: 'candy', name: 'Candy', baseSpriteId: '252', valueRange: [5, 18], materials: MATERIAL_POOL, rarities: RARITY_POOL, effectType: 'none', traits: ['food', 'dessert'] },
  { id: 'floor-chicken', name: 'Floor Chicken', baseSpriteId: '239', valueRange: [8, 22], materials: MATERIAL_POOL, rarities: RARITY_POOL, effectType: 'none', traits: ['food'] },

  // --- Aquatic (broad trait: aquatic) ---
  { id: 'rainbow-trout', name: 'Rainbow Trout', baseSpriteId: '259', valueRange: [5, 20], materials: MATERIAL_POOL, rarities: RARITY_POOL, effectType: 'none', traits: ['aquatic'] },
  { id: 'pickled-jellyfish', name: 'Pickled Jellyfish', baseSpriteId: '264', valueRange: [8, 25], materials: MATERIAL_POOL, rarities: RARITY_POOL, effectType: 'none', traits: ['aquatic'] },
  { id: 'dried-octopus', name: 'Dried Octopus', baseSpriteId: '265', valueRange: [10, 30], materials: MATERIAL_POOL, rarities: RARITY_POOL, effectType: 'none', traits: ['aquatic'] },
];

function randInt(min: number, max: number): number {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

function pick<T>(arr: T[]): T {
  return arr[randInt(0, arr.length - 1)];
}

function pickWeighted<T extends { weight: number }>(arr: T[]): T {
  const roll = Math.random() * arr.reduce((total, entry) => total + entry.weight, 0);
  let cursor = 0;
  for (const entry of arr) {
    cursor += entry.weight;
    if (roll < cursor) return entry;
  }
  return arr[arr.length - 1];
}

let instanceCounter = 0;

function rollSpecialModifier(maxRounds: number | null): ItemInstance['specialModifier'] {
  if (FORCE_CURSED_OVERLAY) return 'Cursed';
  // 10 rounds = 20% each; 20 rounds = 10% each. Unlimited games use 10%.
  const chancePerModifier = Math.min(0.5, maxRounds === null ? 0.1 : 2 / maxRounds);
  const roll = Math.random();
  if (roll < chancePerModifier) return 'Cursed';
  if (roll < chancePerModifier * 2) return 'Blessed';
  return undefined;
}

export function rollItemInstance(maxRounds: number | null, excludedTemplateIds: ReadonlySet<string> = new Set()): ItemInstance {
  const availableTemplates = ITEM_TEMPLATES.filter((template) => !excludedTemplateIds.has(template.id));
  if (availableTemplates.length === 0) throw new Error('No unused item templates remain.');

  const template = pick(availableTemplates);
  const material = pickWeighted(WEIGHTED_MATERIAL_POOL).value;
  const specialModifier = rollSpecialModifier(maxRounds);
  const rarity = pickWeighted(WEIGHTED_RARITY_POOL).value;
  const [min, max] = template.valueRange;

  instanceCounter += 1;
  return {
    id: `item-${instanceCounter}`,
    templateId: template.id,
    material,
    specialModifier,
    loner: Math.random() < 0.05,
    investment: Math.random() < 0.05,
    fairTrade: Math.random() < 0.05,
    rarity,
    trueValue: randInt(min, max),
    hiddenTraitId: rollHiddenTrait(),
    visual: {
      baseSpriteId: template.baseSpriteId,
      paletteId: 'default', // Day 3: derive from material
      overlayEffectIds: [], // Day 3: derive from rarity
    },
  };
}

export function getTemplate(templateId: string): ItemTemplate | undefined {
  return ITEM_TEMPLATES.find((t) => t.id === templateId);
}
