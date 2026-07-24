import type { LotPoolItem } from 'shared';
import { getTemplate } from 'shared';
import { SpriteIcon } from './SpriteIcon';

interface LotPoolProps {
  pool: LotPoolItem[];
  onClose: () => void;
}

export function LotPool({ pool, onClose }: LotPoolProps) {
  return (
    <div className="mirror-picker-overlay" role="dialog" aria-label="Lot Pool">
      <div className="panel mirror-picker-panel">
        <div className="inventory-heading">
          <h2 className="panel-title">LOT POOL</h2>
          <button type="button" className="inventory-close" aria-label="Close" onClick={onClose}>×</button>
        </div>
        <p className="status-line">
          Every item that could come up this game. Not all of them will be sold, the sale order is a surprise, and a few are still a mystery.
        </p>
        <div className="inventory-grid lot-pool-grid">
          {pool.map((entry) => {
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
            return (
              <div key={entry.id} className={slotClasses} title={hidden ? 'Mystery item' : template?.name}>
                <SpriteIcon index={Number(template?.baseSpriteId ?? 0)} scale={2} />
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
