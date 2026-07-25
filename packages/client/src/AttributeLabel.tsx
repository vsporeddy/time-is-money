import { getTraitDefinition } from 'shared';

interface AttributeLabelProps {
  traitId?: string;
  label: string;
}

function setBonusColor(tierCount: number, tierIndex: number): 'bronze' | 'silver' | 'gold' {
  if (tierCount === 1) return 'silver';
  if (tierCount === 2) return tierIndex === 0 ? 'bronze' : 'silver';
  return tierIndex === 0 ? 'bronze' : tierIndex === 1 ? 'silver' : 'gold';
}

function setBonusText(traitId: string, tier: { bonus: number; multiplier?: number; bonusPerMatchingItem?: number; matchingItemMultiplier?: number; strongestMatchingItemMultiplier?: number }): string {
  if (traitId === 'cursed' && tier.multiplier) return 'Change modifier to 1.25x';
  if (tier.bonusPerMatchingItem) return `ALL Musical +$${tier.bonusPerMatchingItem}`;
  if (tier.matchingItemMultiplier) return `Aquatic items ×${tier.matchingItemMultiplier}`;
  if (tier.strongestMatchingItemMultiplier) return `Most Valuable Armor ×${tier.strongestMatchingItemMultiplier}`;
  return tier.multiplier ? `×${tier.multiplier}` : `+$${tier.bonus}`;
}

export function AttributeLabel({ traitId, label }: AttributeLabelProps) {
  const trait = traitId ? getTraitDefinition(traitId) : undefined;
  if (!trait) return <>{label}</>;

  return (
    <span className="attribute-bonus-trigger" tabIndex={0}>
      {label}
      <span className="attribute-bonus-tooltip">
        <b>{trait.noSetBonus ? 'TRINKETS' : `${trait.name} SET BONUS`}</b>
        {trait.noSetBonus
          ? <><span>Trinkets are valuable on their own.</span><span>They have no SET bonus.</span></>
          : trait.tiers.map((tier, index) => (
            <span key={tier.count} className={`set-bonus-tier ${setBonusColor(trait.tiers.length, index)}`}>
              {tier.count}: {setBonusText(trait.id, tier)}
            </span>
          ))}
      </span>
    </span>
  );
}
