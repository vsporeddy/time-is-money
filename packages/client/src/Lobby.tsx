import { useEffect, useRef, useState } from 'react';
import { MAX_BOTS } from 'shared';
import { copyText } from './lobbyLink';
import { playClick } from './sound';

interface LobbyProps {
  lobbyCode: string;
  inviteLink: string | null; // null when there's no shareable URL (e.g. the itch.io embed) — share the code instead
  isHost: boolean;
  hostName: string | null;
  playerCount: number;
  maxPlayers: number;
  botCount: number;
  roundLimit: number;
  onRoundLimitChange: (maxRounds: number) => void;
  onStartGame: () => void;
  onAddBot: () => void;
  onRemoveBot: () => void;
}

export function Lobby({
  lobbyCode,
  inviteLink,
  isHost,
  hostName,
  playerCount,
  maxPlayers,
  botCount,
  roundLimit,
  onRoundLimitChange,
  onStartGame,
  onAddBot,
  onRemoveBot,
}: LobbyProps) {
  const [copyState, setCopyState] = useState<'idle' | 'copied' | 'failed'>('idle');
  // A real, visible input rather than an offscreen node: it doubles as the
  // execCommand fallback target and as manual select-and-copy if both fail.
  const linkRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (copyState === 'idle') return;
    const timer = window.setTimeout(() => setCopyState('idle'), 2000);
    return () => window.clearTimeout(timer);
  }, [copyState]);

  const shareValue = inviteLink ?? lobbyCode;

  const handleCopy = async () => {
    playClick();
    setCopyState((await copyText(shareValue, linkRef.current)) ? 'copied' : 'failed');
  };

  return (
    <div className="panel">
      <h2 className="panel-title">
        AUCTION <span className="lobby-code">{lobbyCode}</span>
      </h2>

      <div className="invite-row">
        <input
          ref={linkRef}
          type="text"
          className="invite-link-input"
          value={shareValue}
          readOnly
          aria-label={inviteLink ? 'Invite link' : 'Auction code'}
          onFocus={(event) => event.currentTarget.select()}
        />
        <button
          type="button"
          className={`btn invite-copy-btn${copyState === 'copied' ? ' copied' : ''}`}
          onClick={handleCopy}
        >
          {copyState === 'copied' ? 'COPIED!' : inviteLink ? 'COPY INVITE LINK' : 'COPY CODE'}
        </button>
      </div>
      <p className="invite-hint" aria-live="polite">
        {copyState === 'failed'
          ? 'Copy failed — select the box above and copy it manually.'
          : inviteLink
            ? 'Send this link to a friend to bring them into this auction.'
            : 'Share this code — your friends enter it on the join screen.'}
      </p>

      <p className="status-line">
        {playerCount} of {maxPlayers} players — waiting for bidders…
      </p>

      {isHost ? (
        <>
          <div className="round-limit-control">
            <label htmlFor="round-limit">Rounds: {roundLimit}</label>
            <input
              id="round-limit"
              type="range"
              min="10"
              max="25"
              step="1"
              value={roundLimit}
              onChange={(event) => onRoundLimitChange(Number(event.target.value))}
            />
            <div className="round-limit-labels"><span>10</span><span>25</span></div>
          </div>
          <button
            className="btn btn-block"
            disabled={playerCount < 2}
            onClick={() => {
              playClick();
              onStartGame();
            }}
          >
            START GAME
          </button>
          <div className="bot-stepper" role="group" aria-label="Bot count">
            <span className="bot-stepper-label">BOTS</span>
            <button
              type="button"
              className="btn bot-stepper-button"
              disabled={botCount === 0}
              aria-label="Remove bot"
              onClick={() => {
                playClick();
                onRemoveBot();
              }}
            >
              −
            </button>
            <span className="bot-stepper-count">{botCount}/{MAX_BOTS}</span>
            <button
              type="button"
              className="btn bot-stepper-button"
              disabled={botCount >= MAX_BOTS}
              aria-label="Add bot"
              onClick={() => {
                playClick();
                onAddBot();
              }}
            >
              +
            </button>
          </div>
        </>
      ) : (
        <>
          <p className="status-line">Waiting for {hostName ?? 'the host'} to open the auction…</p>
          <p className="status-line">Rounds: {roundLimit}</p>
        </>
      )}

      {playerCount < 2 && (
        <p className="error-text">Not enough bidders to start the game.</p>
      )}
    </div>
  );
}
