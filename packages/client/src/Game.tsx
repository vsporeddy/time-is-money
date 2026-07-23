import { useEffect, useState } from 'react';
import type { ItemInstance, ItemTemplate, Player, Round } from 'shared';
import { getHiddenTrait, getTemplate, getTraitDefinition } from 'shared';
import { SpriteIcon } from './SpriteIcon';
import { PortraitIcon } from './PortraitIcon';

function templateFlags(template: ItemTemplate | undefined): string[] {
  if (!template) return [];
  const flags: string[] = [];
  if (template.scoreScaling === 'investment') flags.push('Investment — scores more the longer you held to win it');
  if (template.scoreScaling === 'bargain') flags.push('Bargain — scores more the cheaper you win it');
  if (template.secondPriceRebate) flags.push('Fair Trade — only pay the runner-up\'s price, rest refunded');
  if (template.effectType === 'timeRefund' && template.timeRefund) {
    flags.push(
      template.timeRefund.mode === 'catchup'
        ? 'Emergency Refund — big time refund if you\'re running low'
        : `Time Refund — +${(template.timeRefund.amountMs / 1000).toFixed(0)}s on win`
    );
  }
  if (template.loner) flags.push(`Loner — bonus if it's the only one of these you own`);
  return flags;
}

interface CurrentRound {
  round: Round;
  item: Omit<ItemInstance, 'trueValue'>;
}

interface LastResult {
  round: Round;
  item: ItemInstance;
}

interface GameProps {
  players: Player[];
  myId: string;
  isObserver: boolean;
  currentRound: CurrentRound | null;
  liveTimes: Record<string, number>;
  liveBids: Record<string, number>; // playerId -> committedMs, present only while currently holding
  droppedThisRound: Record<string, number>; // playerId -> committedMs, present once they've folded this round
  lastResult: LastResult | null;
  onHoldStart: () => void;
  onHoldRelease: () => void;
}

function fmt(ms: number) {
  return (Math.max(0, ms) / 1000).toFixed(1) + 's';
}

export function Game({
  players,
  myId,
  isObserver,
  currentRound,
  liveTimes,
  liveBids,
  droppedThisRound,
  lastResult,
  onHoldStart,
  onHoldRelease,
}: GameProps) {
  const isHolding = (id: string) => liveBids[id] !== undefined;
  const isDropped = (id: string) => droppedThisRound[id] !== undefined;

  const iHaveDropped = isDropped(myId);
  const myTime = liveTimes[myId] ?? players.find((p) => p.id === myId)?.timeRemainingMs ?? 0;
  const canHold = !isObserver && currentRound?.round.status === 'active' && !iHaveDropped && myTime > 0;

  // The server only confirms bidding/withdrawn state via round_tick / bidder_dropped,
  // which lags a click by up to ~100ms (or never visibly arrives at all if an
  // uncontested bid resolves instantly) — track it optimistically so the button
  // flips the instant it's tapped, then let server state correct/confirm it.
  const [optimisticBidding, setOptimisticBidding] = useState(false);
  useEffect(() => {
    setOptimisticBidding(false);
  }, [currentRound?.round.id]);

  const iAmHolding = !iHaveDropped && (optimisticBidding || isHolding(myId));

  const handleBidClick = () => {
    if (iAmHolding) {
      setOptimisticBidding(false);
      onHoldRelease();
    } else if (canHold) {
      setOptimisticBidding(true);
      onHoldStart();
    }
  };

  return (
    <>
      <ul className="player-row">
        {players.map((p) => {
          const holding = isHolding(p.id);
          const dropped = isDropped(p.id);
          const isMe = p.id === myId;
          const time = liveTimes[p.id] ?? p.timeRemainingMs;
          const classes = ['player-card', isMe && 'me', holding && 'holding', dropped && 'dropped']
            .filter(Boolean)
            .join(' ');
          return (
            <li key={p.id} className={classes}>
              <PortraitIcon index={p.portraitIndex} />
              <div className="name">
                {p.name}
                {isMe ? ' (you)' : ''}
              </div>
              {p.isObserver ? (
                <div>Observing</div>
              ) : (
                <>
                  <div>{fmt(time)} left</div>
                  {holding && <div>bidding {fmt(liveBids[p.id])}</div>}
                  {dropped && <div>withdrew — spent {fmt(droppedThisRound[p.id])}</div>}
                </>
              )}
            </li>
          );
        })}
      </ul>

      {lastResult &&
        (() => {
          const hidden = getHiddenTrait(lastResult.item.hiddenTraitId);
          return (
            <div className="item-card">
              <h3 className="sold-title">SOLD</h3>
              <p className="item-meta">
                {getTemplate(lastResult.item.templateId)?.name} ({lastResult.item.material}, {lastResult.item.rarity}) —
                true value ${lastResult.item.trueValue}
              </p>
              {hidden && (
                <p className={`hidden-trait ${hidden.scoreBonus >= 0 ? 'positive' : 'negative'}`}>
                  {hidden.name} ({hidden.scoreBonus >= 0 ? '+' : ''}
                  {hidden.scoreBonus})
                </p>
              )}
              <p className="item-meta">
                {lastResult.round.winnerId
                  ? `Won by ${players.find((p) => p.id === lastResult.round.winnerId)?.name ?? 'someone'}`
                  : 'No one held on — item goes unclaimed.'}
              </p>
              <p className="item-meta">Next lot incoming…</p>
            </div>
          );
        })()}

      {!lastResult && currentRound && (
        <div className="item-card">
          <div className="item-sprite">
            <SpriteIcon index={Number(currentRound.item.visual.baseSpriteId)} scale={5} />
          </div>
          <h3 className="item-name">{getTemplate(currentRound.item.templateId)?.name}</h3>
          <p className="item-meta">
            {currentRound.item.material} · {currentRound.item.rarity} · value: ???
          </p>

          <div className="tag-row">
            {getTemplate(currentRound.item.templateId)?.traits.map((id) => (
              <span key={id} className="tag">
                {getTraitDefinition(id)?.name ?? id}
              </span>
            ))}
          </div>

          {templateFlags(getTemplate(currentRound.item.templateId)).length > 0 && (
            <div className="tag-row">
              {templateFlags(getTemplate(currentRound.item.templateId)).map((flag) => (
                <span key={flag} className="tag tag-flag">
                  {flag}
                </span>
              ))}
            </div>
          )}

          {currentRound.round.status === 'pending' && <p className="status-line">Get ready…</p>}

          {currentRound.round.status === 'active' &&
            (isObserver ? (
              <p className="status-line">You're observing this round.</p>
            ) : (
              <>
                <button
                  disabled={!canHold && !iAmHolding}
                  onClick={handleBidClick}
                  className={`bid-button${iAmHolding ? ' active' : ''}`}
                  style={{ marginTop: '1rem' }}
                >
                  {iHaveDropped ? 'Withdrawn' : iAmHolding ? 'Withdraw' : 'Bid'}
                </button>
                {iAmHolding && <p className="spend-line">Spending: {fmt(liveBids[myId] ?? 0)}</p>}
              </>
            ))}
        </div>
      )}
    </>
  );
}
