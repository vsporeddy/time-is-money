import type { ReactNode } from 'react';
import { usePanelDrag } from './usePanelDrag';

interface CreditsProps {
  onClose: () => void;
}

// Mirrors CREDITS.md — keep the two in sync when attributions change.
const CREDIT_SECTIONS: { heading: string; body: ReactNode }[] = [
  {
    heading: 'Item Sprites',
    body: (
      <>
        Matt Firth (shikashipx)
      </>
    ),
  },
  { heading: 'Sound Effects', body: 'Oryx Design Lab' },
  { heading: 'Music', body: 'Fesliyan Studios' },
  {
    heading: 'Character Sprites',
    body: (
      <>
        FinchL (
        <a href="https://finchl.itch.io" target="_blank" rel="noreferrer">
          finchl.itch.io
        </a>
        )
      </>
    ),
  },
  {
    heading: 'Font',
    body: (
      <>
        "Press Start 2P" by Cody "CodeMan38" Boisclair, via{' '}
        <a href="https://fonts.google.com/specimen/Press+Start+2P" target="_blank" rel="noreferrer">
          Google Fonts
        </a>
        , licensed under the SIL Open Font License 1.1.
      </>
    ),
  },
];

export function Credits({ onClose }: CreditsProps) {
  const { panelRef, panelStyle, headingProps } = usePanelDrag<HTMLDivElement>('credits');

  return (
    <div className="mirror-picker-overlay" role="dialog" aria-label="Credits">
      <div ref={panelRef} style={panelStyle} className="panel mirror-picker-panel">
        <div {...headingProps}>
          <h2 className="panel-title">CREDITS</h2>
          <button type="button" className="inventory-close" aria-label="Close" onClick={onClose}>×</button>
        </div>
        {CREDIT_SECTIONS.map((section) => (
          <div key={section.heading} className="credits-section">
            <h3>{section.heading}</h3>
            <p className="status-line">{section.body}</p>
          </div>
        ))}
      </div>
    </div>
  );
}
