import type { LotPoolItem } from 'shared';
import { getTemplate } from 'shared';
import { SpriteIcon } from './SpriteIcon';

interface LotPoolProps {
  pool: LotPoolItem[];
  onClose: () => void;
}

export function LotPool({ pool, onClose }: LotPoolProps) {
  // Only a Magnifying Glass owner ever gets saleRound populated — its presence
  // anywhere in the pool means the whole schedule (and every mystery item) is revealed.
  const fullyRevealed = pool.some((entry) => entry.saleRound !== undefined);

  const sorted = fullyRevealed
    ? [...pool].sort((a, b) => (a.saleRound ?? Infinity) - (b.saleRound ?? Infinity))
    : pool;

  return (
    <div className="mirror-picker-overlay" role="dialog" aria-label="Lot Pool">
      <div className="panel mirror-picker-panel">
        <div className="inventory-heading">
          <h2 className="panel-title">LOT POOL</h2>
          <button type="button" className="inventory-close" aria-label="Close" onClick={onClose}>×</button>
        </div>
        <p className="status-line">
          {fullyRevealed
            ? 'Magnifying Glass: the full sale order is revealed below. Unnumbered items are reserves and stay out of the auction unless swapped in.'
            : 'Every item that could come up this game. Not all of them will be sold, the sale order is a surprise, and a few are still a mystery.'}
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
            return (
              <div key={entry.id} className={slotClasses} title={label}>
                {entry.saleRound !== undefined && <span className="lot-pool-round-badge">{entry.saleRound}</span>}
                {hidden ? <span className="lot-pool-mystery-mark">?</span> : <SpriteIcon index={Number(template?.baseSpriteId ?? 0)} scale={2} />}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
