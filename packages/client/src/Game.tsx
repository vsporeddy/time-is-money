import { useEffect, useState } from 'react';
import type { ItemInstance, ItemTemplate, Player, Round } from 'shared';
import { getHiddenTrait, getTemplate, getTraitDefinition } from 'shared';
import { SpriteIcon } from './SpriteIcon';
import { playClick } from './sound';

function templateAttributes(template: ItemTemplate | undefined): string[] {
  if (!template) return [];
  const attributes = template.traits.map((id) => getTraitDefinition(id)?.name ?? id);
  if (template.scoreScaling === 'investment') attributes.push('Investment');
  if (template.scoreScaling === 'bargain') attributes.push('Bargain');
  if (template.secondPriceRebate) attributes.push('Fair Trade');
  if (template.effectType === 'timeRefund' && template.timeRefund) {
    attributes.push(template.timeRefund.mode === 'catchup' ? 'Emergency Refund' : 'Time Refund');
  }
  if (template.loner) attributes.push('Loner');
  return attributes;
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

function modifierClass(value: string): string {
  return `modifier-${value.toLowerCase().replace(/\s+/g, '-')}`;
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
  const [now, setNow] = useState(Date.now());
  const isHolding = (id: string) => liveBids[id] !== undefined;
  const isDropped = (id: string) => droppedThisRound[id] !== undefined;

  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 100);
    return () => window.clearInterval(timer);
  }, []);

  const iHaveDropped = isDropped(myId);
  const myTime = liveTimes[myId] ?? players.find((p) => p.id === myId)?.timeRemainingMs ?? 0;
  const canHold =
    !isObserver &&
    currentRound?.round.status === 'active' &&
    !iHaveDropped &&
    myTime > 0 &&
    (currentRound.round.bidWindowOpen || isHolding(myId));

  // The server only confirms bidding/withdrawn state via round_tick / bidder_dropped,
  // which lags a click by up to ~100ms (or never visibly arrives at all if an
  // uncontested bid resolves instantly) — track it optimistically so the button
  // flips the instant it's tapped, then let server state correct/confirm it.
  const [optimisticBidding, setOptimisticBidding] = useState(false);
  useEffect(() => {
    setOptimisticBidding(false);
  }, [currentRound?.round.id]);

  const iAmHolding = !iHaveDropped && (optimisticBidding || isHolding(myId));
  const initialBidDeadline = currentRound?.round.initialBidDeadlineAt;
  const initialBidSeconds = initialBidDeadline === null || initialBidDeadline === undefined
    ? null
    : Math.max(0, (initialBidDeadline - now) / 1000);
  const showInitialBidTimer =
    currentRound?.round.status === 'active' &&
    initialBidSeconds !== null &&
    currentRound.round.bidWindowOpen;

  const handleBidClick = () => {
    playClick();
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
      {showInitialBidTimer && (
        <div className="initial-bid-timer" role="status" aria-live="polite">
          <strong>{initialBidSeconds.toFixed(1)}s</strong>
          <small>Bid before time runs out or this lot is passed.</small>
        </div>
      )}
      {lastResult &&
        (() => {
          const hidden = getHiddenTrait(lastResult.item.hiddenTraitId);
          return (
            <div className="item-card">
              <h3 className="sold-title">{lastResult.round.winnerId ? 'SOLD' : 'PASSED'}</h3>
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
              {lastResult.round.winnerId && (
                <p className="item-meta">
                  Winning time spent: {fmt(lastResult.round.bidders[lastResult.round.winnerId]?.committedMs ?? 0)}
                </p>
              )}
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
          <div className="auction-details">
            <div>
              <p>Modifiers</p>
              <ul>
                <li className={`modifier ${modifierClass(currentRound.item.material)}`}>{currentRound.item.material}</li>
                <li className={`modifier ${modifierClass(currentRound.item.rarity)}`}>{currentRound.item.rarity}</li>
              </ul>
            </div>
            <div>
              <p>Attributes</p>
              <ul>
                {templateAttributes(getTemplate(currentRound.item.templateId)).map((attribute) => (
                  <li key={attribute}>{attribute}</li>
                ))}
              </ul>
            </div>
          </div>
          <p className="item-meta">Value: ???</p>

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
                  {iHaveDropped ? 'Withdrawn' : iAmHolding ? (currentRound.round.bidWindowOpen ? 'Cancel Bid' : 'Withdraw') : 'Bid'}
                </button>
                {iAmHolding && !currentRound.round.bidWindowOpen && <p className="spend-line">Spending: {fmt(liveBids[myId] ?? 0)}</p>}
              </>
            ))}
        </div>
      )}
    </>
  );
}
