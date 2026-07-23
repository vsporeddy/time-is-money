import type { ItemInstance, ItemTemplate } from './index.js';

// Placeholder lots for the Day 2 core-loop test. Names/values are flavor
// text for a doomsday-clearance premise; real sprite mapping lands Day 3.
export const ITEM_TEMPLATES: ItemTemplate[] = [
  {
    id: 'flare',
    name: 'Signal Flare',
    baseSpriteId: '0',
    valueRange: [20, 60],
    materials: ['Standard', 'Waterproof'],
    rarities: ['common', 'rare'],
    effectType: 'none',
  },
  {
    id: 'rations',
    name: 'Emergency Rations',
    baseSpriteId: '1',
    valueRange: [10, 40],
    materials: ['Dented', 'Sealed'],
    rarities: ['common', 'rare'],
    effectType: 'none',
  },
  {
    id: 'battery',
    name: 'Spare Battery',
    baseSpriteId: '2',
    valueRange: [15, 50],
    materials: ['Corroded', 'Fresh'],
    rarities: ['common', 'rare', 'legendary'],
    effectType: 'none',
  },
  {
    id: 'envelope',
    name: 'Sealed Envelope',
    baseSpriteId: '3',
    valueRange: [0, 150],
    materials: ['Plain', 'Wax-sealed'],
    rarities: ['common', 'rare', 'legendary'],
    effectType: 'none',
  },
  {
    id: 'toolbox',
    name: 'Rusty Toolbox',
    baseSpriteId: '4',
    valueRange: [25, 70],
    materials: ['Rusty', 'Oiled'],
    rarities: ['common', 'rare'],
    effectType: 'none',
  },
  {
    id: 'radio',
    name: 'Hand-crank Radio',
    baseSpriteId: '5',
    valueRange: [30, 90],
    materials: ['Cracked', 'Mint'],
    rarities: ['common', 'rare', 'legendary'],
    effectType: 'none',
  },
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
