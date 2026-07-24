import { getTraitDefinition } from 'shared';

interface AttributeLabelProps {
  traitId?: string;
  label: string;
}

export function AttributeLabel({ traitId, label }: AttributeLabelProps) {
  const trait = traitId ? getTraitDefinition(traitId) : undefined;
  if (!trait) return <>{label}</>;

  return (
    <span className="attribute-bonus-trigger" tabIndex={0}>
      {label}
      <span className="attribute-bonus-tooltip">
        <b>{trait.name} SET BONUS</b>
        {trait.tiers.map((tier) => (
          <span key={tier.count}>
            {tier.count}: {trait.id === 'cursed' && tier.multiplier ? 'Change modifier to 1.25x' : tier.multiplier ? `×${tier.multiplier}` : `+$${tier.bonus}`}
          </span>
        ))}
      </span>
    </span>
  );
}
