import type { ItemInstance, Player, ScoreBreakdown } from './index.js';
import { getTemplate } from './items.js';
import { getHiddenTrait, TRAIT_DEFINITIONS } from './traits.js';
import type { TraitTier } from './traits.js';

const INVESTMENT_RATE_PER_SEC = 1;
const BARGAIN_CAP_SECONDS = 5;
const BARGAIN_RATE_PER_SEC = 8;
const CONTRABAND_WEAPON_MULTIPLIER = 2;

// Antiquarian/Smuggler: class-gated set bonuses for trait categories that get
// no bonus otherwise (trinket is explicitly noSetBonus; weapon isn't even a
// TraitDefinition) — same shape as TraitTier, just applied outside the
// TRAIT_DEFINITIONS loop since they're conditional on the owner's class.
const ANTIQUARIAN_TRINKET_TIERS: TraitTier[] = [{ count: 2, bonus: 10 }, { count: 4, bonus: 25 }, { count: 6, bonus: 45 }];
const SMUGGLER_WEAPON_TIERS: TraitTier[] = [{ count: 2, bonus: 10 }, { count: 4, bonus: 25 }];

const RARITY_MULTIPLIERS: Record<string, number> = {
  Common: 1,
  Rare: 1.2,
  Legendary: 1.5,
};

const MATERIAL_MULTIPLIERS: Record<string, number> = {
  Ordinary: 1,
  Damaged: 0.8,
  Mint: 1.2,
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
function diminishingMultiplier(copyIndex: number, softened: boolean): number {
  if (copyIndex <= 0) return 1;
  if (copyIndex === 1) return softened ? 0.95 : 0.85;
  return softened ? 0.85 : 0.7;
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
    const activeTraitTiers = new Map<string, TraitTier>();
    for (const def of TRAIT_DEFINITIONS) {
      const count = def.materialMatch
        ? items.filter((i) => i.specialModifier === def.materialMatch).length
        : items.filter((i) => getTemplate(i.templateId)?.traits.includes(def.id)).length;

      const tier = [...def.tiers].reverse().find((t) => count >= t.count);
      if (tier) {
        activeTraitTiers.set(def.id, tier);
        const appliedBonus = tier.bonus + (tier.bonusPerMatchingItem ?? 0) * count;
        traitBonuses.push({
          traitId: def.id,
          count,
          bonus: appliedBonus,
          multiplier: tier.multiplier ?? tier.matchingItemMultiplier ?? tier.strongestMatchingItemMultiplier,
        });
      }
    }

    // Antiquarian/Smuggler: same tier-lookup shape as TRAIT_DEFINITIONS above,
    // but gated to the owner's class instead of being universal.
    if (player.classId === 'antiquarian') {
      const count = items.filter((i) => getTemplate(i.templateId)?.traits.includes('trinket')).length;
      const tier = [...ANTIQUARIAN_TRINKET_TIERS].reverse().find((t) => count >= t.count);
      if (tier) traitBonuses.push({ traitId: 'trinket', count, bonus: tier.bonus });
    }
    if (player.classId === 'smuggler') {
      const count = items.filter((i) => getTemplate(i.templateId)?.traits.includes('weapon')).length;
      const tier = [...SMUGGLER_WEAPON_TIERS].reverse().find((t) => count >= t.count);
      if (tier) traitBonuses.push({ traitId: 'weapon', count, bonus: tier.bonus });
    }

    let baseValue = 0;
    let hiddenTraitBonus = 0;
    let scoreScalingBonus = 0;
    const solitaireBonus = items.filter((item) => item.solitaire).length === 1 ? 20 : 0;
    const hasContrabandPermit = items.some((item) => getTemplate(item.templateId)?.effectType === 'weaponMultiplier');
    const armorMultiplier = activeTraitTiers.get('armor')?.strongestMatchingItemMultiplier ?? 1;
    const strongestArmorItemId = armorMultiplier > 1
      ? items
        .filter((item) => getTemplate(item.templateId)?.traits.includes('armor'))
        .reduce<{ id: string; value: number } | undefined>((strongest, item) => {
          const candidateValue =
            item.trueValue *
            getRarityValueMultiplier(item.rarity) *
            getMaterialValueMultiplier(item.material) *
            (activeTraitTiers.get(item.specialModifier?.toLowerCase() ?? '')?.multiplier ?? getSpecialModifierValueMultiplier(item.specialModifier));
          return !strongest || candidateValue > strongest.value ? { id: item.id, value: candidateValue } : strongest;
        }, undefined)?.id
      : undefined;

    const seenSoFarByTemplate = new Map<string, number>();
    for (const item of items) {
      const template = getTemplate(item.templateId);
      const copyIndex = seenSoFarByTemplate.get(item.templateId) ?? 0;
      seenSoFarByTemplate.set(item.templateId, copyIndex + 1);

      const specialSetMultiplier = item.specialModifier
        ? activeTraitTiers.get(item.specialModifier.toLowerCase())?.multiplier
        : undefined;
      // Fence: ignores the Cursed value penalty specifically — the Cursed set
      // bonus (from specialSetMultiplier) still applies on top if earned.
      const fenceIgnoresCursedPenalty = player.classId === 'fence' && item.specialModifier === 'Cursed';
      const specialMultiplier = specialSetMultiplier ?? (fenceIgnoresCursedPenalty ? 1 : getSpecialModifierValueMultiplier(item.specialModifier));
      const weaponMultiplier = hasContrabandPermit && (template?.weapon || template?.effectType === 'weaponImmunity') ? CONTRABAND_WEAPON_MULTIPLIER : 1;
      const aquaticMultiplier = template?.traits.includes('aquatic')
        ? activeTraitTiers.get('aquatic')?.matchingItemMultiplier ?? 1
        : 1;
      const strongestArmorMultiplier = item.id === strongestArmorItemId ? armorMultiplier : 1;
      baseValue +=
        item.trueValue *
        diminishingMultiplier(copyIndex, player.classId === 'hoarder') *
        getRarityValueMultiplier(item.rarity) *
        getMaterialValueMultiplier(item.material) *
        specialMultiplier *
        weaponMultiplier *
        aquaticMultiplier *
        strongestArmorMultiplier;

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
    const total = baseValue + hiddenTraitBonus + scoreScalingBonus + solitaireBonus + traitBonusTotal;

    return {
      playerId: player.id,
      baseValue: Math.round(baseValue),
      hiddenTraitBonus,
      scoreScalingBonus: Math.round(scoreScalingBonus),
      solitaireBonus,
      traitBonuses,
      total: Math.round(total),
    };
  });
}
