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

export function AttributeLabel({ traitId, label }: AttributeLabelProps) {
  const trait = traitId ? getTraitDefinition(traitId) : undefined;
  if (!trait) return <>{label}</>;

  return (
    <span className="attribute-bonus-trigger" tabIndex={0}>
      {label}
      <span className="attribute-bonus-tooltip">
        <b>{trait.name} SET BONUS</b>
        {trait.tiers.map((tier, index) => (
          <span key={tier.count} className={`set-bonus-tier ${setBonusColor(trait.tiers.length, index)}`}>
            {tier.count}: {trait.id === 'cursed' && tier.multiplier ? 'Change modifier to 1.25x' : tier.multiplier ? `×${tier.multiplier}` : `+$${tier.bonus}`}
          </span>
        ))}
      </span>
    </span>
  );
}
