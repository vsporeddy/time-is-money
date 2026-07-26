import type { Player } from 'shared';
import { PortraitIcon } from './PortraitIcon';
import { usePanelDrag } from './usePanelDrag';

interface PlayerPickerProps {
  title: string;
  subtitle: string;
  players: Player[]; // pre-filtered to eligible candidates
  error?: string | null;
  onSelect: (playerId: string) => void;
  onCancel: () => void;
}

// Used by weapon effects that target a single player directly (Dual Daggers,
// Wooden Dagger) rather than an item in their inventory.
export function PlayerPicker({ title, subtitle, players, error, onSelect, onCancel }: PlayerPickerProps) {
  const { panelRef, panelStyle, headingProps } = usePanelDrag<HTMLDivElement>('player-picker');

  return (
    <div className="mirror-picker-overlay" role="dialog" aria-label={title}>
      <div ref={panelRef} style={panelStyle} className="panel mirror-picker-panel">
        <div {...headingProps}>
          <h2 className="panel-title">{title}</h2>
          <button type="button" className="inventory-close" aria-label="Cancel" onClick={onCancel}>×</button>
        </div>
        <p className="status-line">{subtitle}</p>
        {error && <p className="error-text">{error}</p>}
        {players.length === 0 ? (
          <p className="status-line">No valid targets right now.</p>
        ) : (
          <ul className="player-picker-list">
            {players.map((player) => (
              <li key={player.id}>
                <button type="button" className="player-picker-option" onClick={() => onSelect(player.id)}>
                  <PortraitIcon index={player.portraitIndex} size={36} />
                  <span>{player.name}</span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
