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
  // --- Weapons (low base value; each carries a unique one-time active effect) ---
  // { id: 'wooden-sword', name: 'Wooden Sword', baseSpriteId: '80', baseValue: 10, materials: MATERIAL_POOL, rarities: RARITY_POOL, effectType: 'none', traits: ['weapon', 'sword'] },
  { id: 'flail', name: 'Flail', baseSpriteId: '92', baseValue: 10, materials: MATERIAL_POOL, rarities: RARITY_POOL, effectType: 'destroyLot', weapon: { phase: 'preBid', target: 'none' }, traits: ['weapon'] },
  { id: 'scimitar', name: 'Scimitar', baseSpriteId: '85', baseValue: 10, materials: MATERIAL_POOL, rarities: RARITY_POOL, effectType: 'forceWithdraw', weapon: { phase: 'bidding', target: 'all' }, traits: ['weapon', 'sword'] },
  // { id: 'wooden-dagger', name: 'Wooden Dagger', baseSpriteId: '87', baseValue: 10, materials: MATERIAL_POOL, rarities: RARITY_POOL, effectType: 'forceWithdraw', weapon: { phase: 'bidding', target: 'one' }, traits: ['weapon'] },
  { id: 'dkga', name: "Dark Knight's Greataxe", baseSpriteId: '91', baseValue: 10, materials: MATERIAL_POOL, rarities: RARITY_POOL, effectType: 'forceEnter', weapon: { phase: 'preBid', target: 'all' }, traits: ['weapon'] },
  { id: 'crossbow', name: 'Crossbow', baseSpriteId: '100', baseValue: 10, materials: MATERIAL_POOL, rarities: RARITY_POOL, effectType: 'destroyItem', weapon: { phase: 'anytime', target: 'one' }, traits: ['weapon', 'bow'] },
  { id: 'arcane-staff', name: 'Arcane Staff', baseSpriteId: '103', baseValue: 10, materials: MATERIAL_POOL, rarities: RARITY_POOL, effectType: 'transformLot', weapon: { phase: 'bidding', target: 'none' }, traits: ['weapon'] },
  { id: 'wooden-shield', name: 'Wooden Shield', baseSpriteId: '97', baseValue: 10, materials: MATERIAL_POOL, rarities: RARITY_POOL, effectType: 'weaponImmunity', traits: ['weapon'] },
  // { id: 'dual-daggers', name: 'Dual Daggers', baseSpriteId: '89', baseValue: 10, materials: MATERIAL_POOL, rarities: RARITY_POOL, effectType: 'forceEnter', weapon: { phase: 'preBid', target: 'one', exclusive: true }, traits: ['weapon'] },
  // --- Armor (broad trait: armor) ---
  { id: 'horned-helm', name: 'Horned Helm', baseSpriteId: '115', baseValue: 53, materials: MATERIAL_POOL, rarities: RARITY_POOL, effectType: 'none', traits: ['armor'] },
  { id: 'leather-vest', name: 'Leather Vest', baseSpriteId: '118', baseValue: 38, materials: MATERIAL_POOL, rarities: RARITY_POOL, effectType: 'none', traits: ['armor'] },
  { id: 'plate-armor', name: 'Plate Armor', baseSpriteId: '119', baseValue: 63, materials: MATERIAL_POOL, rarities: RARITY_POOL, effectType: 'none', traits: ['armor'] },
  { id: 'travelers-cuirass', name: "Traveler's Cuirass", baseSpriteId: '117', baseValue: 20, materials: MATERIAL_POOL, rarities: RARITY_POOL, effectType: 'none', traits: ['armor'] },
  { id: 'worn-boots', name: 'Worn Boots', baseSpriteId: '130', baseValue: 17, materials: MATERIAL_POOL, rarities: RARITY_POOL, effectType: 'none', traits: ['armor'] },
  { id: 'reinforced-gauntlet', name: 'Reinforced Gauntlet', baseSpriteId: '129', baseValue: 28, materials: MATERIAL_POOL, rarities: RARITY_POOL, effectType: 'none', traits: ['armor'] },

  // --- Trinkets (broad trait: trinket) ---
  { id: 'gold-pendant', name: 'Gold Pendant', baseSpriteId: '134', baseValue: 40, materials: MATERIAL_POOL, rarities: RARITY_POOL, effectType: 'none', traits: ['trinket'] },
  { id: 'diamond-ring', name: 'Diamond Ring', baseSpriteId: '133', baseValue: 85, materials: MATERIAL_POOL, rarities: RARITY_POOL, effectType: 'none', traits: ['trinket'] },
  { id: 'bonetooth-necklace', name: 'Bonetooth Necklace', baseSpriteId: '136', baseValue: 68, materials: MATERIAL_POOL, rarities: RARITY_POOL, effectType: 'none', traits: ['trinket'] },
  { id: 'one-ring', name: 'The One Ring', baseSpriteId: '132', baseValue: 100, materials: MATERIAL_POOL, rarities: RARITY_POOL, effectType: 'none', traits: ['trinket'] },
  // --- Tools (broad trait: tool) ---
  { id: 'pickaxe', name: 'Pickaxe', baseSpriteId: '162', baseValue: 20, materials: MATERIAL_POOL, rarities: RARITY_POOL, effectType: 'none', traits: ['tool'] },
  { id: 'rusted-lantern', name: 'Rusted Lantern', baseSpriteId: '169', baseValue: 17, materials: MATERIAL_POOL, rarities: RARITY_POOL, effectType: 'timeRefund', timeRefund: { mode: 'catchup', amountMs: 15_000 }, traits: ['tool'] },
  { id: 'apothecary-kit', name: 'Apothecary Kit', baseSpriteId: '188', baseValue: 24, materials: MATERIAL_POOL, rarities: RARITY_POOL, effectType: 'none', traits: ['tool'] },
  { id: 'bear-trap', name: 'Bear Trap', baseSpriteId: '174', baseValue: 19, materials: MATERIAL_POOL, rarities: RARITY_POOL, effectType: 'none', traits: ['tool'] },

  // --- Musical (broad trait: musical) ---
  { id: 'violin', name: 'Violin', baseSpriteId: '180', baseValue: 40, materials: MATERIAL_POOL, rarities: RARITY_POOL, effectType: 'none', traits: ['musical'] },
  { id: 'pan-flute', name: 'Pan Flute', baseSpriteId: '183', baseValue: 30, materials: MATERIAL_POOL, rarities: RARITY_POOL, effectType: 'none', traits: ['musical'] },
  { id: 'ocarina', name: 'Ocarina', baseSpriteId: '181', baseValue: 23, materials: MATERIAL_POOL, rarities: RARITY_POOL, effectType: 'none', traits: ['musical'] },
  // --- Text (broad trait: text, narrow: book) ---
  { id: 'ancient-tome', name: 'Ancient Tome', baseSpriteId: '213', baseValue: 45, materials: MATERIAL_POOL, rarities: RARITY_POOL, effectType: 'none', traits: ['text', 'book'] },
  { id: 'leather-journal', name: 'Leather Journal', baseSpriteId: '210', baseValue: 23, materials: MATERIAL_POOL, rarities: RARITY_POOL, effectType: 'none', traits: ['text', 'book'] },
  { id: 'sealed-scroll', name: 'Sealed Scroll', baseSpriteId: '220', baseValue: 45, materials: MATERIAL_POOL, rarities: RARITY_POOL, effectType: 'none', traits: ['text'] },
  { id: 'love-letter', name: 'Love Letter', baseSpriteId: '218', baseValue: 15, materials: MATERIAL_POOL, rarities: RARITY_POOL, effectType: 'none', traits: ['text'] },

  // --- Food (broad trait: food, narrow: dessert) ---
  { id: 'fresh-apple', name: 'Fresh Apple', baseSpriteId: '224', baseValue: 8, materials: MATERIAL_POOL, rarities: RARITY_POOL, effectType: 'none', traits: ['food'] },
  { id: 'stale-bread', name: 'Stale Bread', baseSpriteId: '237', baseValue: 7, materials: MATERIAL_POOL, rarities: RARITY_POOL, effectType: 'none', traits: ['food'] },
  { id: 'aged-cheese', name: 'Aged Cheese', baseSpriteId: '247', baseValue: 14, materials: MATERIAL_POOL, rarities: RARITY_POOL, effectType: 'none', traits: ['food'] },
  { id: 'chocolate-cake', name: 'Chocolate Cake', baseSpriteId: '253', baseValue: 20, materials: MATERIAL_POOL, rarities: RARITY_POOL, effectType: 'none', traits: ['food', 'dessert'] },
  { id: 'candy', name: 'Candy', baseSpriteId: '252', baseValue: 12, materials: MATERIAL_POOL, rarities: RARITY_POOL, effectType: 'none', traits: ['food', 'dessert'] },
  { id: 'floor-chicken', name: 'Floor Chicken', baseSpriteId: '239', baseValue: 15, materials: MATERIAL_POOL, rarities: RARITY_POOL, effectType: 'none', traits: ['food'] },

  // --- Aquatic (broad trait: aquatic) ---
  { id: 'rainbow-trout', name: 'Rainbow Trout', baseSpriteId: '259', baseValue: 13, materials: MATERIAL_POOL, rarities: RARITY_POOL, effectType: 'none', traits: ['aquatic'] },
  { id: 'pickled-jellyfish', name: 'Pickled Jellyfish', baseSpriteId: '264', baseValue: 17, materials: MATERIAL_POOL, rarities: RARITY_POOL, effectType: 'none', traits: ['aquatic'] },
  { id: 'dried-octopus', name: 'Dried Octopus', baseSpriteId: '265', baseValue: 20, materials: MATERIAL_POOL, rarities: RARITY_POOL, effectType: 'none', traits: ['aquatic'] },
  { id: 'clownfish', name: 'Clownfish', baseSpriteId: '263', baseValue: 12, materials: MATERIAL_POOL, rarities: RARITY_POOL, effectType: 'none', traits: ['aquatic'] },
  { id: 'rotting-boot', name: 'Rotting Boot', baseSpriteId: '268', baseValue: 8, materials: MATERIAL_POOL, rarities: RARITY_POOL, effectType: 'none', traits: ['aquatic'] },
  { id: 'fish-skeleton', name: 'Fish Skeleton', baseSpriteId: '267', baseValue: 6, materials: MATERIAL_POOL, rarities: RARITY_POOL, effectType: 'none', traits: ['aquatic'] },
  { id: 'ancient-fossil', name: 'Ancient Fossil', baseSpriteId: '269', baseValue: 30, materials: MATERIAL_POOL, rarities: RARITY_POOL, effectType: 'none', traits: ['aquatic'] },

  // --- Curios (flat value, no modifiers/traits, unique standalone effects) ---
  { id: 'magnifying-glass', name: 'Magnifying Glass', baseSpriteId: '168', baseValue: 5, materials: ['Ordinary'], rarities: ['Common'], effectType: 'revealValue', flatValue: true, traits: [] },
  { id: 'spyglass', name: 'Spyglass', baseSpriteId: '167', baseValue: 5, materials: ['Ordinary'], rarities: ['Common'], effectType: 'revealBidding', flatValue: true, traits: [] },
  { id: 'treasure-chest', name: 'Treasure Chest', baseSpriteId: '187', baseValue: 10, materials: ['Ordinary'], rarities: ['Common'], effectType: 'chest', flatValue: true, traits: [], chest: { keyTemplateId: 'rusty-key', grantsTraitId: 'trinket', grantsCountRange: [1, 3] } },
  { id: 'sunken-treasure-chest', name: 'Sunken Treasure Chest', baseSpriteId: '270', baseValue: 0, materials: ['Ordinary'], rarities: ['Common'], effectType: 'chest', flatValue: true, traits: [], chest: { keyTemplateId: 'rusty-key', grantsTraitId: 'aquatic', grantsCountRange: [3, 5] } },
  { id: 'rusty-key', name: 'Rusty Key', baseSpriteId: '185', baseValue: 1, materials: ['Ordinary'], rarities: ['Common'], effectType: 'key', flatValue: true, traits: [] },
  { id: 'chronomancers-hourglass', name: "Chronomancer's Hourglass", baseSpriteId: '352', baseValue: 0, materials: ['Ordinary'], rarities: ['Common'], effectType: 'refundOnLoss', flatValue: true, traits: [] },
  { id: 'mirror-of-desire', name: 'Mirror of Desire', baseSpriteId: '177', baseValue: 5, materials: ['Ordinary'], rarities: ['Common'], effectType: 'copyItem', flatValue: true, traits: [] },
  { id: 'contraband-permit', name: 'Contraband Permit', baseSpriteId: '219', baseValue: 5, materials: ['Ordinary'], rarities: ['Common'], effectType: 'weaponMultiplier', flatValue: true, traits: [] },
];

// Fisher-Yates — used to pick the game's fixed lot pool and randomize its auction order.
export function shuffle<T>(arr: readonly T[]): T[] {
  const result = [...arr];
  for (let i = result.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [result[i], result[j]] = [result[j], result[i]];
  }
  return result;
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

function buildInstanceFromTemplate(template: ItemTemplate, maxRounds: number | null): ItemInstance {
  instanceCounter += 1;
  const visual = {
    baseSpriteId: template.baseSpriteId,
    paletteId: 'default', // Day 3: derive from material
    overlayEffectIds: [], // Day 3: derive from rarity
  };

  if (template.flatValue) {
    return {
      id: `item-${instanceCounter}`,
      templateId: template.id,
      material: 'Ordinary',
      rarity: 'Common',
      trueValue: template.baseValue,
      visual,
    };
  }

  const material = pickWeighted(WEIGHTED_MATERIAL_POOL).value;
  const specialModifier = rollSpecialModifier(maxRounds);
  const rarity = pickWeighted(WEIGHTED_RARITY_POOL).value;

  return {
    id: `item-${instanceCounter}`,
    templateId: template.id,
    material,
    specialModifier,
    loner: Math.random() < 0.05,
    investment: Math.random() < 0.05,
    fairTrade: Math.random() < 0.05,
    rarity,
    trueValue: template.baseValue,
    hiddenTraitId: rollHiddenTrait(),
    visual,
  };
}

// Rolls an instance of a specific template, bypassing the pool/exclusion logic —
// used for bonus items granted outside the normal auction flow (e.g. chest rewards).
export function rollItemInstanceForTemplate(templateId: string, maxRounds: number | null): ItemInstance {
  const template = getTemplate(templateId);
  if (!template) throw new Error(`Unknown item template: ${templateId}`);
  return buildInstanceFromTemplate(template, maxRounds);
}

// Duplicates an existing instance's exact rolled stats under a fresh id —
// used by the Mirror of Desire to copy another player's item.
export function cloneItemInstance(source: ItemInstance): ItemInstance {
  instanceCounter += 1;
  return { ...source, id: `item-${instanceCounter}` };
}

export function getTemplate(templateId: string): ItemTemplate | undefined {
  return ITEM_TEMPLATES.find((t) => t.id === templateId);
}
