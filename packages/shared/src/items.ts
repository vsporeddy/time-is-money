import type { ItemInstance, ItemTemplate } from './index.js';
import { MATERIAL_POOL, rollHiddenTrait } from './traits.js';

const RARITY_POOL = ['common', 'rare', 'legendary'];

// baseSpriteId indices refer to the annotated sprites_reference.png grid
// (index = row * 16 + col, 0-indexed top-left). Starting trait/flag
// assignments below are a first pass — tune freely while playtesting.
export const ITEM_TEMPLATES: ItemTemplate[] = [
  // --- Weapons (broad trait: weapon) ---
  { id: 'rusty-sword', name: 'Rusty Sword', baseSpriteId: '80', valueRange: [15, 45], materials: MATERIAL_POOL, rarities: RARITY_POOL, effectType: 'none', traits: ['weapon', 'sword'] },
  { id: 'iron-sword', name: 'Iron Sword', baseSpriteId: '81', valueRange: [25, 65], materials: MATERIAL_POOL, rarities: RARITY_POOL, effectType: 'none', traits: ['weapon', 'sword'] },
  { id: 'ornate-sword', name: 'Ornate Sword', baseSpriteId: '84', valueRange: [50, 140], materials: MATERIAL_POOL, rarities: RARITY_POOL, effectType: 'none', traits: ['weapon', 'sword'], loner: 30 },
  { id: 'combat-dagger', name: 'Combat Dagger', baseSpriteId: '87', valueRange: [10, 35], materials: MATERIAL_POOL, rarities: RARITY_POOL, effectType: 'none', traits: ['weapon'] },
  { id: 'battle-axe', name: 'Battle Axe', baseSpriteId: '90', valueRange: [30, 80], materials: MATERIAL_POOL, rarities: RARITY_POOL, effectType: 'none', traits: ['weapon'] },
  { id: 'hunting-bow', name: 'Hunting Bow', baseSpriteId: '99', valueRange: [25, 70], materials: MATERIAL_POOL, rarities: RARITY_POOL, effectType: 'none', traits: ['weapon', 'bow'] },
  { id: 'crossbow', name: 'Crossbow', baseSpriteId: '100', valueRange: [35, 90], materials: MATERIAL_POOL, rarities: RARITY_POOL, effectType: 'none', traits: ['weapon', 'bow'] },
  { id: 'arcane-staff', name: 'Arcane Staff', baseSpriteId: '105', valueRange: [40, 120], materials: MATERIAL_POOL, rarities: RARITY_POOL, effectType: 'none', traits: ['weapon', 'staff'], scoreScaling: 'investment' },
  { id: 'riot-shield', name: 'Riot Shield', baseSpriteId: '97', valueRange: [20, 55], materials: MATERIAL_POOL, rarities: RARITY_POOL, effectType: 'none', traits: ['weapon'] },

  // --- Armor (broad trait: armor) ---
  { id: 'horned-helm', name: 'Horned Helm', baseSpriteId: '115', valueRange: [30, 75], materials: MATERIAL_POOL, rarities: RARITY_POOL, effectType: 'none', traits: ['armor'] },
  { id: 'leather-vest', name: 'Leather Vest', baseSpriteId: '118', valueRange: [20, 55], materials: MATERIAL_POOL, rarities: RARITY_POOL, effectType: 'none', traits: ['armor'] },
  { id: 'chainmail', name: 'Chainmail', baseSpriteId: '119', valueRange: [35, 90], materials: MATERIAL_POOL, rarities: RARITY_POOL, effectType: 'none', traits: ['armor'] },
  { id: 'travelers-hood', name: "Traveler's Hood", baseSpriteId: '117', valueRange: [10, 30], materials: MATERIAL_POOL, rarities: RARITY_POOL, effectType: 'none', traits: ['armor'], scoreScaling: 'bargain' },
  { id: 'worn-boots', name: 'Worn Boots', baseSpriteId: '130', valueRange: [8, 25], materials: MATERIAL_POOL, rarities: RARITY_POOL, effectType: 'none', traits: ['armor'] },
  { id: 'reinforced-gauntlet', name: 'Reinforced Gauntlet', baseSpriteId: '129', valueRange: [15, 40], materials: MATERIAL_POOL, rarities: RARITY_POOL, effectType: 'none', traits: ['armor'] },

  // --- Trinkets (broad trait: trinket) ---
  { id: 'gold-ring', name: 'Gold Ring', baseSpriteId: '134', valueRange: [20, 60], materials: MATERIAL_POOL, rarities: RARITY_POOL, effectType: 'none', traits: ['trinket'] },
  { id: 'diamond-ring', name: 'Diamond Ring', baseSpriteId: '133', valueRange: [40, 130], materials: MATERIAL_POOL, rarities: RARITY_POOL, effectType: 'none', traits: ['trinket'], scoreScaling: 'investment' },
  { id: 'ruby-necklace', name: 'Ruby Necklace', baseSpriteId: '136', valueRange: [35, 100], materials: MATERIAL_POOL, rarities: RARITY_POOL, effectType: 'none', traits: ['trinket'], loner: 25 },

  // --- Tools (broad trait: tool) ---
  { id: 'pickaxe', name: 'Pickaxe', baseSpriteId: '162', valueRange: [10, 30], materials: MATERIAL_POOL, rarities: RARITY_POOL, effectType: 'none', traits: ['tool'], secondPriceRebate: true },
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
  { id: 'sealed-scroll', name: 'Sealed Scroll', baseSpriteId: '220', valueRange: [0, 90], materials: MATERIAL_POOL, rarities: RARITY_POOL, effectType: 'none', traits: ['text'], scoreScaling: 'bargain' },
  { id: 'love-letter', name: 'Love Letter', baseSpriteId: '218', valueRange: [5, 25], materials: MATERIAL_POOL, rarities: RARITY_POOL, effectType: 'none', traits: ['text'] },

  // --- Food (broad trait: food, narrow: dessert) ---
  { id: 'fresh-apple', name: 'Fresh Apple', baseSpriteId: '224', valueRange: [3, 12], materials: MATERIAL_POOL, rarities: RARITY_POOL, effectType: 'none', traits: ['food'] },
  { id: 'stale-bread', name: 'Stale Bread', baseSpriteId: '237', valueRange: [3, 10], materials: MATERIAL_POOL, rarities: RARITY_POOL, effectType: 'none', traits: ['food'] },
  { id: 'aged-cheese', name: 'Aged Cheese', baseSpriteId: '247', valueRange: [8, 20], materials: MATERIAL_POOL, rarities: RARITY_POOL, effectType: 'none', traits: ['food'] },
  { id: 'chocolate-cake', name: 'Chocolate Cake', baseSpriteId: '253', valueRange: [10, 30], materials: MATERIAL_POOL, rarities: RARITY_POOL, effectType: 'none', traits: ['food', 'dessert'] },
  { id: 'candy', name: 'Candy', baseSpriteId: '252', valueRange: [5, 18], materials: MATERIAL_POOL, rarities: RARITY_POOL, effectType: 'none', traits: ['food', 'dessert'] },
  { id: 'floor-chicken', name: 'Floor Chicken', baseSpriteId: '239', valueRange: [8, 22], materials: MATERIAL_POOL, rarities: RARITY_POOL, effectType: 'none', traits: ['food'] },

  // --- Aquatic (broad trait: aquatic) ---
  { id: 'rainbow-trout', name: 'Rainbow Trout', baseSpriteId: '259', valueRange: [5, 20], materials: MATERIAL_POOL, rarities: RARITY_POOL, effectType: 'none', traits: ['aquatic'], secondPriceRebate: true },
  { id: 'pickled-jellyfish', name: 'Pickled Jellyfish', baseSpriteId: '264', valueRange: [8, 25], materials: MATERIAL_POOL, rarities: RARITY_POOL, effectType: 'none', traits: ['aquatic'] },
  { id: 'dried-octopus', name: 'Dried Octopus', baseSpriteId: '265', valueRange: [10, 30], materials: MATERIAL_POOL, rarities: RARITY_POOL, effectType: 'none', traits: ['aquatic'] },
];

function randInt(min: number, max: number): number {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

function pick<T>(arr: T[]): T {
  return arr[randInt(0, arr.length - 1)];
}

let instanceCounter = 0;

export function rollItemInstance(): ItemInstance {
  const template = pick(ITEM_TEMPLATES);
  const material = pick(template.materials);
  const rarity = pick(template.rarities);
  const [min, max] = template.valueRange;

  instanceCounter += 1;
  return {
    id: `item-${instanceCounter}`,
    templateId: template.id,
    material,
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
