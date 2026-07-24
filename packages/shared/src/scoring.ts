import type { ItemInstance, Player, ScoreBreakdown } from './index.js';
import { getTemplate } from './items.js';
import { getHiddenTrait, TRAIT_DEFINITIONS } from './traits.js';

const INVESTMENT_RATE_PER_SEC = 1;
const BARGAIN_CAP_SECONDS = 5;
const BARGAIN_RATE_PER_SEC = 8;
const CONTRABAND_WEAPON_MULTIPLIER = 3;

const RARITY_MULTIPLIERS: Record<string, number> = {
  Common: 1,
  Rare: 1.2,
  Legendary: 1.5,
};

const MATERIAL_MULTIPLIERS: Record<string, number> = {
  Ordinary: 1,
  Weathered: 0.8,
  Pristine: 1.2,
};

const SPECIAL_MODIFIER_MULTIPLIERS: Record<NonNullable<ItemInstance['specialModifier']>, number> = {
  Cursed: 0.75,
  Blessed: 1.1,
};

export function getRarityValueMultiplier(rarity: string): number {
  return RARITY_MULTIPLIERS[rarity] ?? 1;
}

export function getMaterialValueMultiplier(material: string): number {
  return MATERIAL_MULTIPLIERS[material] ?? 1;
}

export function getSpecialModifierValueMultiplier(specialModifier: ItemInstance['specialModifier']): number {
  return specialModifier ? SPECIAL_MODIFIER_MULTIPLIERS[specialModifier] : 1;
}

export function getItemValueMultiplier(item: ItemInstance): number {
  return (
    getRarityValueMultiplier(item.rarity) *
    getMaterialValueMultiplier(item.material) *
    getSpecialModifierValueMultiplier(item.specialModifier)
  );
}

// Anti-hoarding: owning the exact same template more than once scores worse
// on the 2nd+ copy — the first copy is always full value. Doesn't touch
// trait counting — a stash of different swords still gets full value and
// full "Sword"/"Weapon" credit, only literal duplicates are discouraged.
function diminishingMultiplier(copyIndex: number): number {
  if (copyIndex <= 0) return 1;
  if (copyIndex === 1) return 0.85;
  return 0.7;
}

export function computeScores(
  players: Player[],
  wonItems: Map<string, ItemInstance>,
  pricePaidMs: Map<string, number>
): ScoreBreakdown[] {
  return players.map((player) => {
    const items = player.stash
      .map((id) => wonItems.get(id))
      .filter((item): item is ItemInstance => Boolean(item));

    const traitBonuses: ScoreBreakdown['traitBonuses'] = [];
    const activeTraitTiers = new Map<string, { bonus: number; multiplier?: number }>();
    for (const def of TRAIT_DEFINITIONS) {
      const count = def.materialMatch
        ? items.filter((i) => i.specialModifier === def.materialMatch).length
        : items.filter((i) => getTemplate(i.templateId)?.traits.includes(def.id)).length;

      const tier = [...def.tiers].reverse().find((t) => count >= t.count);
      if (tier) {
        activeTraitTiers.set(def.id, tier);
        traitBonuses.push({ traitId: def.id, count, bonus: tier.bonus, multiplier: tier.multiplier });
      }
    }

    let baseValue = 0;
    let hiddenTraitBonus = 0;
    let scoreScalingBonus = 0;
    const lonerBonus = items.filter((item) => item.loner).length === 1 ? 20 : 0;
    const hasContrabandPermit = items.some((item) => getTemplate(item.templateId)?.effectType === 'weaponMultiplier');

    const seenSoFarByTemplate = new Map<string, number>();
    for (const item of items) {
      const template = getTemplate(item.templateId);
      const copyIndex = seenSoFarByTemplate.get(item.templateId) ?? 0;
      seenSoFarByTemplate.set(item.templateId, copyIndex + 1);

      const specialSetMultiplier = item.specialModifier
        ? activeTraitTiers.get(item.specialModifier.toLowerCase())?.multiplier
        : undefined;
      const specialMultiplier = specialSetMultiplier ?? getSpecialModifierValueMultiplier(item.specialModifier);
      const weaponMultiplier = hasContrabandPermit && template?.traits.includes('weapon') ? CONTRABAND_WEAPON_MULTIPLIER : 1;
      baseValue +=
        item.trueValue *
        diminishingMultiplier(copyIndex) *
        getRarityValueMultiplier(item.rarity) *
        getMaterialValueMultiplier(item.material) *
        specialMultiplier *
        weaponMultiplier;

      const hidden = getHiddenTrait(item.hiddenTraitId);
      if (hidden) hiddenTraitBonus += hidden.scoreBonus;

      if (item.investment || template?.scoreScaling) {
        const paidSeconds = (pricePaidMs.get(item.id) ?? 0) / 1000;
        if (item.investment) {
          scoreScalingBonus += paidSeconds * INVESTMENT_RATE_PER_SEC;
        } else {
          scoreScalingBonus += Math.max(0, BARGAIN_CAP_SECONDS - paidSeconds) * BARGAIN_RATE_PER_SEC;
        }
      }

    }

    const traitBonusTotal = traitBonuses.reduce((sum, t) => sum + t.bonus, 0);
    const total = baseValue + hiddenTraitBonus + scoreScalingBonus + lonerBonus + traitBonusTotal;

    return {
      playerId: player.id,
      baseValue: Math.round(baseValue),
      hiddenTraitBonus,
      scoreScalingBonus: Math.round(scoreScalingBonus),
      lonerBonus,
      traitBonuses,
      total: Math.round(total),
    };
  });
}
