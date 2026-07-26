import type { ItemInstance, ItemTemplate } from './index.js';
import { MATERIAL_POOL, rollHiddenTrait } from './traits.js';

const RARITY_POOL = ['Common', 'Rare', 'Legendary'];
const WEIGHTED_RARITY_POOL = [
  { value: 'Common', weight: 50 },
  { value: 'Rare', weight: 100 / 3 },
  { value: 'Legendary', weight: 50 / 3 },
];
const WEIGHTED_MATERIAL_POOL = [
  { value: 'Used', weight: 50 },
  { value: 'Damaged', weight: 250 / 7 },
  { value: 'Mint', weight: 100 / 7 },
];

// Temporary playtest flag — set to false to restore normal Blessed/Cursed rolls.
const FORCE_CURSED_OVERLAY = false;

// baseSpriteId indices refer to the annotated sprites_reference.png grid
// (index = row * 16 + col, 0-indexed top-left). Starting trait/flag
// assignments below are a first pass — tune freely while playtesting.
export const ITEM_TEMPLATES: ItemTemplate[] = [
  // --- Weapons (low base value; each carries a unique one-time active effect) ---
  { id: 'flail', name: 'Flail', flavorText: 'Swung more in anger than in war.', baseSpriteId: '92', baseValue: 10, materials: MATERIAL_POOL, rarities: RARITY_POOL, effectType: 'destroyLot', weapon: { phase: 'preBid', target: 'none' }, traits: ['weapon'] },
  { id: 'scimitar', name: 'Scimitar', flavorText: 'Its curve was made for closing distance fast.', baseSpriteId: '85', baseValue: 10, materials: MATERIAL_POOL, rarities: RARITY_POOL, effectType: 'forceWithdraw', weapon: { phase: 'bidding', target: 'all' }, traits: ['weapon'] },
  { id: 'crossbow', name: 'Crossbow', flavorText: 'No skill required, just a steady grip.', baseSpriteId: '100', baseValue: 10, materials: MATERIAL_POOL, rarities: RARITY_POOL, effectType: 'destroyItem', weapon: { phase: 'anytime', target: 'one' }, traits: ['weapon'] },
  { id: 'arcane-staff', name: 'Arcane Staff', flavorText: 'It hums faintly, like it remembers a spell.', baseSpriteId: '103', baseValue: 10, materials: MATERIAL_POOL, rarities: RARITY_POOL, effectType: 'transformLot', weapon: { phase: 'bidding', target: 'none' }, traits: ['weapon', 'magic'] },
  { id: 'bandits-dagger', name: "Bandit's Dagger", flavorText: 'Light enough to lift a purse without a sound.', baseSpriteId: '87', baseValue: 10, materials: MATERIAL_POOL, rarities: RARITY_POOL, effectType: 'stealTime', weapon: { phase: 'anytime', target: 'one' }, traits: ['weapon'] },
  // --- Armor (broad trait: armor) ---
  { id: 'iron-helm', name: 'Iron Helm', flavorText: 'Dented in three places, none of them fatal.', baseSpriteId: '115', baseValue: 29, materials: MATERIAL_POOL, rarities: RARITY_POOL, effectType: 'none', traits: ['armor'] },
  { id: 'leather-vest', name: 'Leather Vest', flavorText: 'Cracked but supple, broken in by someone else.', baseSpriteId: '118', baseValue: 21, materials: MATERIAL_POOL, rarities: RARITY_POOL, effectType: 'none', traits: ['armor'] },
  { id: 'plate-armor', name: 'Plate Armor', flavorText: 'Heavy enough to make you forget why you wanted it.', baseSpriteId: '119', baseValue: 35, materials: MATERIAL_POOL, rarities: RARITY_POOL, effectType: 'none', traits: ['armor'] },
  { id: 'apprentices-cloak', name: "Apprentice's Cloak", flavorText: 'Singed at the hem from a lesson gone wrong.', baseSpriteId: '126', baseValue: 11, materials: MATERIAL_POOL, rarities: RARITY_POOL, effectType: 'none', traits: ['armor', 'magic'] },
  { id: 'battle-graves', name: 'Battle Graves', flavorText: 'Scuffed shin to ankle, a record of every retreat.', baseSpriteId: '131', baseValue: 9, materials: MATERIAL_POOL, rarities: RARITY_POOL, effectType: 'none', traits: ['armor'] },
  { id: 'steel-gauntlets', name: 'Steel Gauntlets', flavorText: 'Cold to the touch even after a day in the sun.', baseSpriteId: '129', baseValue: 15, materials: MATERIAL_POOL, rarities: RARITY_POOL, effectType: 'none', traits: ['armor'] },

  // --- Trinkets (broad trait: trinket) ---
  { id: 'gold-pendant', name: 'Gold Pendant', flavorText: 'Warm to the touch, like it was worn just moments ago.', baseSpriteId: '134', baseValue: 23, materials: MATERIAL_POOL, rarities: RARITY_POOL, effectType: 'none', traits: ['trinket'] },
  { id: 'diamond-ring', name: 'Diamond Ring', flavorText: 'Somewhere, a proposal went unanswered.', baseSpriteId: '133', baseValue: 48, materials: MATERIAL_POOL, rarities: RARITY_POOL, effectType: 'none', traits: ['trinket'] },
  { id: 'necklace-of-fangs', name: 'Necklace of Fangs', flavorText: 'Each tooth tells a story the wearer never shared.', baseSpriteId: '136', baseValue: 39, materials: MATERIAL_POOL, rarities: RARITY_POOL, effectType: 'none', traits: ['trinket'] },
  { id: 'one-ring', name: 'The One Ring', flavorText: 'It feels like it wants to be found.', baseSpriteId: '132', baseValue: 57, materials: MATERIAL_POOL, rarities: RARITY_POOL, effectType: 'none', traits: ['trinket', 'magic'] },
  { id: 'championship-belt', name: 'Championship Belt', flavorText: 'The engraving is scratched out and rewritten twice.', baseSpriteId: '127', baseValue: 42, materials: MATERIAL_POOL, rarities: RARITY_POOL, effectType: 'none', traits: ['trinket'] },
  { id: 'cowrie-chain', name: 'Cowrie Chain', flavorText: 'Once currency, now just decoration.', baseSpriteId: '135', baseValue: 31, materials: MATERIAL_POOL, rarities: RARITY_POOL, effectType: 'none', traits: ['trinket'] },

  // --- Text ---
  { id: 'ancient-tome', name: 'Ancient Tome', flavorText: 'The spine cracks like it hasn\u2019t been opened in years.', baseSpriteId: '212', baseValue: 31, materials: MATERIAL_POOL, rarities: RARITY_POOL, effectType: 'none', traits: ['text'] },
  { id: 'bards-score', name: "Bard's Score", flavorText: 'The margins are full of notes for a song never finished.', baseSpriteId: '219', baseValue: 36, materials: MATERIAL_POOL, rarities: RARITY_POOL, effectType: 'none', traits: ['text', 'musical'] },
  { id: 'treasure-map', name: 'Treasure Map', flavorText: 'The X has been redrawn at least four times.', baseSpriteId: '220', baseValue: 31, materials: MATERIAL_POOL, rarities: RARITY_POOL, effectType: 'none', traits: ['text'] },
  { id: 'love-letter', name: 'Love Letter', flavorText: 'Never sent, and folded so many times it nearly tore.', baseSpriteId: '217', baseValue: 10, materials: MATERIAL_POOL, rarities: RARITY_POOL, effectType: 'none', traits: ['text'] },
  { id: 'mariners-log', name: "Mariner's Log", flavorText: 'The last entry just says "storm."', baseSpriteId: '216', baseValue: 16, materials: MATERIAL_POOL, rarities: RARITY_POOL, effectType: 'none', traits: ['aquatic', 'text'] },
  { id: 'crimson-codex', name: 'Crimson Codex', flavorText: 'Bound in something that was probably not leather.', baseSpriteId: '215', baseValue: 26, materials: MATERIAL_POOL, rarities: RARITY_POOL, effectType: 'none', traits: ['text', 'magic'] },

  // --- Musical (broad trait: musical) ---
  { id: 'harp', name: 'Harp', flavorText: 'A few strings are missing, but it still sings.', baseSpriteId: '179', baseValue: 18, materials: MATERIAL_POOL, rarities: RARITY_POOL, effectType: 'none', traits: ['musical'] },
  { id: 'violin', name: 'Violin', flavorText: 'The varnish has worn thin where a chin once rested.', baseSpriteId: '180', baseValue: 14, materials: MATERIAL_POOL, rarities: RARITY_POOL, effectType: 'none', traits: ['musical'] },
  { id: 'ocarina', name: 'Ocarina', flavorText: 'Playing it feels like it should open something.', baseSpriteId: '181', baseValue: 8, materials: MATERIAL_POOL, rarities: RARITY_POOL, effectType: 'none', traits: ['musical', 'magic'] },
  { id: 'flute', name: 'Flute', flavorText: 'Simple, small, and somehow still in tune.', baseSpriteId: '182', baseValue: 7, materials: MATERIAL_POOL, rarities: RARITY_POOL, effectType: 'none', traits: ['musical'] },
  { id: 'panpipes', name: 'Panpipes', flavorText: 'Each reed is a slightly different age.', baseSpriteId: '183', baseValue: 9, materials: MATERIAL_POOL, rarities: RARITY_POOL, effectType: 'none', traits: ['musical'] },
  { id: 'warhorn', name: 'Warhorn', flavorText: 'One blast and every head on the field turns.', baseSpriteId: '184', baseValue: 12, materials: MATERIAL_POOL, rarities: RARITY_POOL, effectType: 'none', traits: ['musical'] },

  // --- Aquatic (broad trait: aquatic) ---
  { id: 'rainbow-trout', name: 'Rainbow Trout', flavorText: 'Still smells faintly of the river.', baseSpriteId: '259', baseValue: 7, materials: MATERIAL_POOL, rarities: RARITY_POOL, effectType: 'none', traits: ['aquatic'] },
  { id: 'pickled-jellyfish', name: 'Pickled Jellyfish', flavorText: 'An acquired taste, allegedly.', baseSpriteId: '264', baseValue: 16, materials: MATERIAL_POOL, rarities: RARITY_POOL, effectType: 'none', traits: ['aquatic'] },
  { id: 'dried-octopus', name: 'Dried Octopus', flavorText: 'Chewy, salty, and somehow still has all eight arms.', baseSpriteId: '265', baseValue: 18, materials: MATERIAL_POOL, rarities: RARITY_POOL, effectType: 'none', traits: ['aquatic'] },
  { id: 'pirates-boot', name: "Pirate's Boot", flavorText: 'Waterlogged, but the buckle still shines.', baseSpriteId: '268', baseValue: 11, materials: MATERIAL_POOL, rarities: RARITY_POOL, effectType: 'none', traits: ['armor', 'aquatic'] },
  { id: 'turtle-shell', name: 'Turtle Shell', flavorText: 'Empty now, but it clearly saw some adventures.', baseSpriteId: '266', baseValue: 12, materials: MATERIAL_POOL, rarities: RARITY_POOL, effectType: 'none', traits: ['aquatic'] },
  { id: 'helix-fossil', name: 'Helix Fossil', flavorText: 'A spiral shape preserved long before anyone was counting years.', baseSpriteId: '269', baseValue: 28, materials: MATERIAL_POOL, rarities: RARITY_POOL, effectType: 'none', traits: ['aquatic', 'magic'] },

  // --- Curios (flat value, no modifiers/traits, unique standalone effects) ---
  { id: 'spyglass', name: 'Spyglass', flavorText: 'Brings distant things, and other people\u2019s secrets, into focus.', baseSpriteId: '167', baseValue: 5, materials: ['Used'], rarities: ['Common'], effectType: 'revealBidding', flatValue: true, traits: [] },
  { id: 'treasure-chest', name: 'Treasure Chest', flavorText: 'Locked tight. Someone out there has the key.', baseSpriteId: '187', baseValue: 0, materials: ['Used'], rarities: ['Common'], effectType: 'chest', flatValue: true, traits: [], chest: { keyTemplateId: 'rusty-key', grantsTraitId: 'trinket', grantsCountRange: [1, 3] } },
  { id: 'sunken-treasure-chest', name: 'Sunken Treasure Chest', flavorText: 'Barnacles and all, it still hasn\u2019t been opened.', baseSpriteId: '270', baseValue: 0, materials: ['Used'], rarities: ['Common'], effectType: 'chest', flatValue: true, traits: [], chest: { keyTemplateId: 'rusty-key', grantsTraitId: 'aquatic', grantsCountRange: [3, 5] } },
  { id: 'rusty-key', name: 'Rusty Key', flavorText: 'It fits something. You just don\u2019t know what yet.', baseSpriteId: '185', baseValue: 1, materials: ['Used'], rarities: ['Common'], effectType: 'key', flatValue: true, traits: [] },
  { id: 'chronomancers-hourglass', name: "Chronomancer's Hourglass", flavorText: 'The sand never seems to run out, no matter how long you watch.', baseSpriteId: '352', baseValue: 0, materials: ['Used'], rarities: ['Common'], effectType: 'refundOnLoss', flatValue: true, traits: ['magic'] },
  { id: 'mirror-of-desire', name: 'Mirror of Desire', flavorText: 'It never shows your own reflection.', baseSpriteId: '177', baseValue: 5, materials: ['Used'], rarities: ['Common'], effectType: 'copyItem', flatValue: true, traits: [] },
  { id: 'contraband-permit', name: 'Contraband Permit', flavorText: 'Official-looking, if you don\u2019t look too closely at the seal.', baseSpriteId: '218', baseValue: 5, materials: ['Used'], rarities: ['Common'], effectType: 'weaponMultiplier', flatValue: true, traits: [] },
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
      material: 'Used',
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
    solitaire: Math.random() < 0.05,
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
// used by the Mirror of Desire to copy another player's item. The copy is
// a fresh, unspent item even if the source's one-time weapon effect was
// already used.
export function cloneItemInstance(source: ItemInstance): ItemInstance {
  instanceCounter += 1;
  return { ...source, id: `item-${instanceCounter}`, usedActiveEffect: false };
}

export function getTemplate(templateId: string): ItemTemplate | undefined {
  return ITEM_TEMPLATES.find((t) => t.id === templateId);
}
