import type { ItemInstance, Player } from 'shared';
import { getTemplate } from 'shared';
import { SpriteIcon } from './SpriteIcon';

interface ItemTargetPickerProps {
  title: string;
  subtitle: string;
  players: Player[];
  myId: string;
  items: Record<string, ItemInstance>;
  excludePlayerIds?: string[]; // e.g. Wooden Shield holders, immune to Crossbow
  error?: string | null;
  onSelect: (targetPlayerId: string, targetItemId: string) => void;
  onCancel: () => void;
}

// Used both by Mirror of Desire (copy) and Crossbow (destroy) — any effect
// that targets a specific item somewhere in another player's inventory.
export function ItemTargetPicker({ title, subtitle, players, myId, items, excludePlayerIds, error, onSelect, onCancel }: ItemTargetPickerProps) {
  const excluded = new Set(excludePlayerIds ?? []);
  const groups = players
    .filter((player) => player.id !== myId && !excluded.has(player.id))
    .map((player) => ({
      player,
      items: player.stash.map((id) => items[id]).filter((item): item is ItemInstance => Boolean(item)),
    }))
    .filter((group) => group.items.length > 0);

  return (
    <div className="mirror-picker-overlay" role="dialog" aria-label={title}>
      <div className="panel mirror-picker-panel">
        <div className="inventory-heading">
          <h2 className="panel-title">{title}</h2>
          <button type="button" className="inventory-close" aria-label="Cancel" onClick={onCancel}>×</button>
        </div>
        <p className="status-line">{subtitle}</p>
        {error && <p className="error-text">{error}</p>}
        {groups.length === 0 ? (
          <p className="status-line">No valid targets right now.</p>
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
                      onClick={() => onSelect(player.id, item.id)}
                      aria-label={`${template?.name ?? item.templateId} (${player.name})`}
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
