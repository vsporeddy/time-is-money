import type { ItemInstance, Player, ScoreBreakdown } from './index.js';
import { getTemplate } from './items.js';
import { getHiddenTrait, TRAIT_DEFINITIONS } from './traits.js';

const INVESTMENT_RATE_PER_SEC = 3;
const BARGAIN_CAP_SECONDS = 5;
const BARGAIN_RATE_PER_SEC = 8;

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

    const countByTemplate = new Map<string, number>();
    for (const item of items) {
      countByTemplate.set(item.templateId, (countByTemplate.get(item.templateId) ?? 0) + 1);
    }

    let baseValue = 0;
    let hiddenTraitBonus = 0;
    let scoreScalingBonus = 0;
    let lonerBonus = 0;

    const seenSoFarByTemplate = new Map<string, number>();
    for (const item of items) {
      const template = getTemplate(item.templateId);
      const totalOfTemplate = countByTemplate.get(item.templateId) ?? 1;
      const copyIndex = seenSoFarByTemplate.get(item.templateId) ?? 0;
      seenSoFarByTemplate.set(item.templateId, copyIndex + 1);

      baseValue += item.trueValue * diminishingMultiplier(copyIndex);

      const hidden = getHiddenTrait(item.hiddenTraitId);
      if (hidden) hiddenTraitBonus += hidden.scoreBonus;

      if (template?.scoreScaling) {
        const paidSeconds = (pricePaidMs.get(item.id) ?? 0) / 1000;
        if (template.scoreScaling === 'investment') {
          scoreScalingBonus += paidSeconds * INVESTMENT_RATE_PER_SEC;
        } else {
          scoreScalingBonus += Math.max(0, BARGAIN_CAP_SECONDS - paidSeconds) * BARGAIN_RATE_PER_SEC;
        }
      }

      if (template?.loner && totalOfTemplate === 1) {
        lonerBonus += template.loner;
      }
    }

    const traitBonuses: ScoreBreakdown['traitBonuses'] = [];
    for (const def of TRAIT_DEFINITIONS) {
      const count = def.materialMatch
        ? items.filter((i) => i.material === def.materialMatch).length
        : items.filter((i) => getTemplate(i.templateId)?.traits.includes(def.id)).length;

      const tier = [...def.tiers].reverse().find((t) => count >= t.count);
      if (tier) traitBonuses.push({ traitId: def.id, count, bonus: tier.bonus });
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
