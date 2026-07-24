import type { ItemInstance, Player } from 'shared';
import { getTemplate } from 'shared';
import { SpriteIcon } from './SpriteIcon';

interface MirrorPickerProps {
  players: Player[];
  myId: string;
  items: Record<string, ItemInstance>;
  error?: string | null;
  onSelect: (itemId: string) => void;
  onCancel: () => void;
}

export function MirrorPicker({ players, myId, items, error, onSelect, onCancel }: MirrorPickerProps) {
  const groups = players
    .filter((player) => player.id !== myId)
    .map((player) => ({
      player,
      items: player.stash.map((id) => items[id]).filter((item): item is ItemInstance => Boolean(item)),
    }))
    .filter((group) => group.items.length > 0);

  return (
    <div className="mirror-picker-overlay" role="dialog" aria-label="Mirror of Desire">
      <div className="panel mirror-picker-panel">
        <div className="inventory-heading">
          <h2 className="panel-title">MIRROR OF DESIRE</h2>
          <button type="button" className="inventory-close" aria-label="Cancel" onClick={onCancel}>×</button>
        </div>
        <p className="status-line">Choose an item to copy for yourself.</p>
        {error && <p className="error-text">{error}</p>}
        {groups.length === 0 ? (
          <p className="status-line">No other items to copy yet.</p>
        ) : (
          groups.map(({ player, items: playerItems }) => (
            <div key={player.id} className="mirror-picker-group">
              <p className="mirror-picker-player-name">{player.name}</p>
              <div className="inventory-grid mirror-picker-grid">
                {playerItems.map((item) => {
                  const template = getTemplate(item.templateId);
                  return (
                    <button
                      type="button"
                      key={item.id}
                      className="inventory-slot inventory-slot-usable mirror-picker-item"
                      onClick={() => onSelect(item.id)}
                      aria-label={`Copy ${template?.name ?? item.templateId}`}
                      title={template?.name}
                    >
                      <SpriteIcon index={Number(item.visual.baseSpriteId)} scale={2} />
                    </button>
                  );
                })}
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
