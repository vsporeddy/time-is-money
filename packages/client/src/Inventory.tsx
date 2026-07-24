import type { ItemInstance, Player, ScoreBreakdown } from 'shared';
import { getHiddenTrait, getMaterialValueMultiplier, getRarityValueMultiplier, getTemplate, getTraitDefinition } from 'shared';
import { SpriteIcon } from './SpriteIcon';

interface InventoryProps {
  player: Player;
  items: Record<string, ItemInstance>;
  score?: ScoreBreakdown;
  side: 'left' | 'right';
  showValue?: boolean;
  onClose?: () => void;
}

const INVENTORY_SIZE = 12;

interface DisplayAttribute {
  label: string;
  traitId?: string;
  effect?: boolean;
}

function itemAttributes(item: ItemInstance): DisplayAttribute[] {
  const template = getTemplate(item.templateId);
  const attributes: DisplayAttribute[] = [];

  for (const traitId of template?.traits ?? []) attributes.push({ label: getTraitDefinition(traitId)?.name ?? traitId, traitId });
  if (item.investment) attributes.push({ label: 'Investment', effect: true });
  if (template?.scoreScaling === 'bargain') attributes.push({ label: 'Bargain' });
  if (item.fairTrade) attributes.push({ label: 'Fair Trade', effect: true });
  if (template?.effectType === 'timeRefund') attributes.push({ label: 'Time Refund' });
  if (item.loner) attributes.push({ label: 'Loner', effect: true });

  return attributes;
}

function modifierClass(value: string): string {
  return `modifier-${value.toLowerCase().replace(/\s+/g, '-')}`;
}

function specialModifierLabel(specialModifier: ItemInstance['specialModifier']): string {
  if (specialModifier === 'Cursed') return 'Cursed';
  if (specialModifier === 'Blessed') return 'Blessed ×1.1';
  return '';
}

export function Inventory({ player, items, score, side, showValue = true, onClose }: InventoryProps) {
  const stash = player.stash.map((id) => items[id]).filter((item): item is ItemInstance => Boolean(item)).slice(0, INVENTORY_SIZE);
  const cursedSetActive = score?.traitBonuses.some((trait) => trait.traitId === 'cursed' && trait.multiplier === 1.25) ?? false;
  const breakdown = score
    ? [
        `Base Value: $${score.baseValue}`,
        score.hiddenTraitBonus !== 0 && `Finds: ${score.hiddenTraitBonus >= 0 ? '+' : ''}$${score.hiddenTraitBonus}`,
        score.scoreScalingBonus !== 0 && `Item effects: +$${score.scoreScalingBonus}`,
        score.lonerBonus !== 0 && `Loner bonuses: +$${score.lonerBonus}`,
        ...score.traitBonuses.map((trait) =>
          `${getTraitDefinition(trait.traitId)?.name ?? trait.traitId} ×${trait.count}: ${trait.multiplier ? `×${trait.multiplier}` : `+$${trait.bonus}`}`
        ),
      ].filter((line): line is string => Boolean(line))
    : ['No revealed items yet.'];

  return (
    <aside className={`inventory-panel inventory-panel-${side}`} aria-label={`${player.name}'s inventory`}>
      <div className="inventory-heading">
        <h2>{side === 'left' ? 'YOUR INVENTORY' : `${player.name.toUpperCase()}'S INVENTORY`}</h2>
        <div className="inventory-heading-actions">
          {showValue && (
            <div className="inventory-total" tabIndex={0}>
              <strong>${score?.total ?? 0}</strong>
              <div className="inventory-tooltip inventory-total-tooltip">
                <b>VALUE BREAKDOWN</b>
                {breakdown.map((line) => (
                  <span key={line}>{line}</span>
                ))}
              </div>
            </div>
          )}
          {onClose && <button type="button" className="inventory-close" aria-label="Minimize inventory" onClick={onClose}>×</button>}
        </div>
      </div>
      <div className="inventory-grid">
        {Array.from({ length: INVENTORY_SIZE }, (_, index) => {
          const item = stash[index];
          const template = item ? getTemplate(item.templateId) : undefined;
          const hiddenTrait = item ? getHiddenTrait(item.hiddenTraitId) : undefined;
          return (
            <div className="inventory-slot" key={item?.id ?? `empty-${index}`}>
              {item && (
                <>
                  <SpriteIcon index={Number(item.visual.baseSpriteId)} scale={2} />
                  <div className="inventory-tooltip inventory-item-tooltip">
                    <b>{template?.name ?? item.templateId}</b>
                    {showValue && <span>Value: ${item.trueValue}</span>}
                    <span>Modifiers:</span>
                    <ul className="inventory-detail-list">
                      <li className={`modifier ${modifierClass(item.material)}`}>{item.material} ×{getMaterialValueMultiplier(item.material).toFixed(1)}</li>
                      <li className={`modifier ${modifierClass(item.rarity)}`}>{item.rarity} ×{getRarityValueMultiplier(item.rarity).toFixed(1)}</li>
                      {item.specialModifier && (
                        <li className={`modifier ${modifierClass(item.specialModifier)}`}>
                          {item.specialModifier === 'Cursed' ? (cursedSetActive ? 'Cursed x1.25' : 'Cursed ×0.75') : specialModifierLabel(item.specialModifier)}
                        </li>
                      )}
                    </ul>
                    <span>Attributes:</span>
                    <ul className="inventory-detail-list">
                      {itemAttributes(item).map((attribute) => (
                        <li key={attribute.label}>
                          <span className={attribute.traitId ? 'attribute-set-label' : attribute.effect ? 'item-effect-label' : undefined}>{attribute.label}</span>
                        </li>
                      ))}
                    </ul>
                    {hiddenTrait && (
                      <span className={`inventory-find ${hiddenTrait.id === 'cursed-find' ? 'find-cursed' : hiddenTrait.id === 'blessed-find' ? 'find-blessed' : ''}`}>
                        {hiddenTrait.name} {hiddenTrait.scoreBonus >= 0 ? '+$' : '-$'}{Math.abs(hiddenTrait.scoreBonus)}
                      </span>
                    )}
                  </div>
                </>
              )}
            </div>
          );
        })}
      </div>
    </aside>
  );
}
