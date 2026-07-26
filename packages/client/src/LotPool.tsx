import type { ItemTemplate, LotPoolItem } from 'shared';
import { getTemplate, getTraitDefinition } from 'shared';
import { SpriteIcon } from './SpriteIcon';
import { getGlowFilter, getItemGlowCategory, getTraitLabelColor } from './itemVisuals';
import { usePanelDrag } from './usePanelDrag';

interface LotPoolProps {
  pool: LotPoolItem[];
  onClose: () => void;
}

function capitalize(value: string): string {
  return value.charAt(0).toUpperCase() + value.slice(1);
}

interface DisplayAttribute {
  label: string;
  effect?: boolean;
  traitId?: string;
}

function itemAttributes(template: ItemTemplate | undefined): DisplayAttribute[] {
  if (!template) return [];
  const attributes: DisplayAttribute[] = template.traits.map((trait) => ({ label: getTraitDefinition(trait)?.name ?? capitalize(trait), traitId: trait }));
  const addEffect = (label: string) => attributes.push({ label, effect: true });
  if (template.effectType === 'revealBidding') addEffect('Scouts Bidders');
  if (template.effectType === 'chest') addEffect('Needs Key');
  if (template.effectType === 'key') addEffect('Opens Chests');
  if (template.effectType === 'refundOnLoss') addEffect('Refunds Losses');
  if (template.effectType === 'copyItem') addEffect('Copies an Item');
  if (template.effectType === 'destroyLot') addEffect('Destroys the Lot');
  if (template.effectType === 'forceEnter') addEffect(template.weapon?.exclusive ? 'Forces a Duel' : 'Forces All to Bid');
  if (template.effectType === 'forceWithdraw') addEffect(template.weapon?.target === 'all' ? 'Clears the Field' : 'Forces a Withdrawal');
  if (template.effectType === 'destroyItem') addEffect('Destroys an Item');
  if (template.effectType === 'transformLot') addEffect('Transforms the Lot');
  if (template.effectType === 'stealTime') addEffect('Steals Time');
  if (template.effectType === 'weaponMultiplier') addEffect('Weapon Value ×2');
  if (template.effectType === 'itemValueMultiplier') addEffect('Gilded Value');
  return attributes;
}

export function LotPool({ pool, onClose }: LotPoolProps) {
  const { panelRef, panelStyle, headingProps, dragging } = usePanelDrag('lot-pool');

  // Only a Merchant ever gets saleRound populated — its presence anywhere in
  // the pool means the whole schedule is revealed (mystery items are a
  // separate Spy ability and may still be blurred here).
  const fullyRevealed = pool.some((entry) => entry.saleRound !== undefined);

  const sorted = fullyRevealed
    ? [...pool].sort((a, b) => (a.saleRound ?? Infinity) - (b.saleRound ?? Infinity))
    : pool;

  return (
    <aside
      ref={panelRef}
      style={panelStyle}
      className={`inventory-panel inventory-panel-right lot-pool-panel${dragging ? ' inventory-panel-dragging' : ''}`}
      aria-label="Lot Pool"
    >
      <div {...headingProps}>
        <h2>LOT POOL</h2>
        <button type="button" className="inventory-close" aria-label="Close" onClick={onClose}>×</button>
      </div>
      <p className="status-line">
        {fullyRevealed
          ? 'Merchant: the full sale order is revealed below. Unnumbered items are reserves and stay out of the auction unless swapped in.'
          : 'Every item that could come up this auction. Not all of them will be sold, the sale order is a surprise, and a few are still a mystery.'}
      </p>
      <div className="inventory-grid lot-pool-grid">
        {sorted.map((entry) => {
          const template = getTemplate(entry.templateId);
          const hidden = entry.status === 'hidden';
          const slotClasses = [
            'inventory-slot',
            'lot-pool-slot',
            hidden && 'lot-pool-slot-hidden',
            entry.status === 'auctioned' && 'lot-pool-slot-auctioned',
          ]
            .filter(Boolean)
            .join(' ');
          const label = hidden
            ? 'Mystery item'
            : entry.saleRound !== undefined
            ? `${template?.name} — Round ${entry.saleRound}`
            : fullyRevealed
            ? `${template?.name} — reserve, not scheduled`
            : template?.name;
          // No rolled instance data is exposed for pool lots yet, so the glow
          // stays at its dull baseline (0 intensity) until an item is actually won.
          const glowFilter = !hidden && template ? getGlowFilter(getItemGlowCategory(template), 0) : undefined;
          return (
            <div key={entry.id} className={slotClasses} title={label}>
              {entry.saleRound !== undefined && <span className="lot-pool-round-badge">{entry.saleRound}</span>}
              {hidden ? <span className="lot-pool-mystery-mark">?</span> : <SpriteIcon index={Number(template?.baseSpriteId ?? 0)} scale={2} glowFilter={glowFilter} />}
              {!hidden && template && (
                <div className="inventory-tooltip inventory-item-tooltip lot-pool-item-tooltip">
                  <b>{template.name}</b>
                  <span>Attributes:</span>
                  <ul className="inventory-detail-list">
                    {itemAttributes(template).map((attribute) => {
                      const traitColor = attribute.traitId ? getTraitLabelColor(attribute.traitId) : undefined;
                      return (
                        <li key={attribute.label}>
                          <span
                            className={!traitColor && attribute.traitId ? 'attribute-set-label' : attribute.effect ? 'item-effect-label' : undefined}
                            style={traitColor ? { color: traitColor } : undefined}
                          >
                            {attribute.label}
                          </span>
                        </li>
                      );
                    })}
                  </ul>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </aside>
  );
}
