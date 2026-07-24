import { useEffect, useRef, useState } from 'react';
import type { ItemInstance, ItemTemplate, Player, Round, ScoreBreakdown } from 'shared';
import { getHiddenTrait, getMaterialValueMultiplier, getRarityValueMultiplier, getTemplate, getTraitDefinition } from 'shared';
import { SpriteIcon } from './SpriteIcon';
import { PortraitIcon } from './PortraitIcon';
import { AttributeLabel } from './AttributeLabel';
import { playClick, playCoin, playCountdownTick } from './sound';

interface DisplayAttribute {
  label: string;
  traitId?: string;
  effect?: boolean;
  tooltip?: { title: string; text: string };
}

function templateAttributes(template: ItemTemplate | undefined, item?: Pick<ItemInstance, 'investment' | 'fairTrade' | 'loner'>): DisplayAttribute[] {
  if (!template) return [];
  const attributes: DisplayAttribute[] = template.traits.map((id) => ({ label: getTraitDefinition(id)?.name ?? id, traitId: id }));
  if (item?.investment) attributes.push({ label: 'Investment', effect: true, tooltip: { title: '+1$ for each second used to bid for this item', text: '' } });
  if (template.scoreScaling === 'bargain') attributes.push({ label: 'Bargain' });
  if (item?.fairTrade) attributes.push({ label: 'Fair Trade', effect: true, tooltip: { title: 'FAIR TRADE', text: "Only costs the runner-up's time spent" } });
  if (item?.loner) attributes.push({ label: 'Loner', effect: true, tooltip: { title: 'If you own only one Loner item: +$20', text: '' } });
  if (template.effectType === 'revealValue') attributes.push({ label: 'Reveals Value', effect: true, tooltip: { title: 'MAGNIFYING GLASS', text: 'Modifiers and true value are always revealed to you while you own one' } });
  if (template.effectType === 'revealBidding') attributes.push({ label: 'Scouts Bidders', effect: true, tooltip: { title: 'SPYGLASS', text: "Other players' time left and bids are always revealed to you while you own one" } });
  if (template.effectType === 'chest' && template.chest) {
    const traitName = getTraitDefinition(template.chest.grantsTraitId)?.name ?? template.chest.grantsTraitId;
    const [min, max] = template.chest.grantsCountRange;
    attributes.push({ label: 'Needs Key', effect: true, tooltip: { title: template.name.toUpperCase(), text: `Combine with a Rusty Key to receive ${min}-${max} ${traitName} item${max > 1 ? 's' : ''}` } });
  }
  if (template.effectType === 'key') attributes.push({ label: 'Opens Chests', effect: true, tooltip: { title: 'RUSTY KEY', text: 'Combine with a matching locked chest — both are consumed' } });
  return attributes;
}

interface CurrentRound {
  round: Round;
  item: Omit<ItemInstance, 'trueValue' | 'hiddenTraitId' | 'material' | 'rarity' | 'specialModifier'> &
    Partial<Pick<ItemInstance, 'material' | 'rarity' | 'specialModifier'>> & { revealedValue?: number };
}

interface LastResult {
  round: Round;
  item: ItemInstance;
}

interface GameProps {
  players: Player[];
  myId: string;
  myScore?: ScoreBreakdown;
  isObserver: boolean;
  roundNumber: number;
  maxRounds: number | null;
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

function specialModifierLabel(specialModifier: ItemInstance['specialModifier']): string {
  if (specialModifier === 'Cursed') return 'Cursed';
  if (specialModifier === 'Blessed') return 'Blessed ×1.1';
  return '';
}

function lerpColor(from: [number, number, number], to: [number, number, number], t: number): string {
  const r = Math.round(from[0] + (to[0] - from[0]) * t);
  const g = Math.round(from[1] + (to[1] - from[1]) * t);
  const b = Math.round(from[2] + (to[2] - from[2]) * t);
  return `rgb(${r}, ${g}, ${b})`;
}

// Shared with both the coin cue's volume ramp and the timer's size/color ramp.
const SPENDING_URGENCY_CAP_SECONDS = 30;
const COIN_MIN_VOLUME = 0.08;
const COIN_MAX_VOLUME = 0.4;

export function Game({
  players,
  myId,
  myScore,
  isObserver,
  roundNumber,
  maxRounds,
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
  const cursedSetActive = myScore?.traitBonuses.some((trait) => trait.traitId === 'cursed' && trait.multiplier === 1.25) ?? false;
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
  // During the opt-in window, holding is free — time (and spending) only
  // starts once the window closes, so that's when the coin cue should too.
  const iAmSpending = iAmHolding && currentRound?.round.bidWindowOpen === false;

  // Ticking "spending money" cue for as long as the player is actively spending —
  // starts quiet and ramps louder the longer the lot has been contested, capping at 30s.
  useEffect(() => {
    if (!iAmSpending) return;
    const startedAt = currentRound?.round.spendingStartedAt ?? Date.now();
    const tick = () => {
      const urgency = Math.min(1, (Date.now() - startedAt) / 1000 / SPENDING_URGENCY_CAP_SECONDS);
      playCoin(COIN_MIN_VOLUME + (COIN_MAX_VOLUME - COIN_MIN_VOLUME) * urgency);
    };
    tick();
    const interval = window.setInterval(tick, 1_000);
    return () => window.clearInterval(interval);
  }, [iAmSpending]);

  const initialBidDeadline = currentRound?.round.initialBidDeadlineAt;
  const initialBidSeconds = initialBidDeadline === null || initialBidDeadline === undefined
    ? null
    : Math.max(0, (initialBidDeadline - now) / 1000);
  const showInitialBidTimer =
    currentRound?.round.status === 'active' &&
    initialBidSeconds !== null &&
    currentRound.round.bidWindowOpen;

  // Ticks once per whole second while the pre-bid countdown is visible.
  const initialBidWholeSeconds = initialBidSeconds !== null ? Math.ceil(initialBidSeconds) : null;
  const prevInitialBidWholeRef = useRef<number | null>(null);
  useEffect(() => {
    if (!showInitialBidTimer || initialBidWholeSeconds === null) {
      prevInitialBidWholeRef.current = null;
      return;
    }
    const previous = prevInitialBidWholeRef.current;
    if (previous !== null && initialBidWholeSeconds < previous) {
      playCountdownTick();
    }
    prevInitialBidWholeRef.current = initialBidWholeSeconds;
  }, [showInitialBidTimer, initialBidWholeSeconds]);

  // Visible to everyone (bidders, folks who folded, and observers alike) once
  // spending starts — nobody's individual spend is revealed, just the clock.
  const spendingStartedAt = currentRound?.round.spendingStartedAt;
  const spendingSeconds = spendingStartedAt ? Math.max(0, (now - spendingStartedAt) / 1000) : null;
  const showSpendingTimer =
    currentRound?.round.status === 'active' && !currentRound.round.bidWindowOpen && spendingSeconds !== null;

  // Grows larger and redder the longer the lot has been contested, capping at 30s.
  const spendingUrgency = spendingSeconds !== null ? Math.min(1, spendingSeconds / SPENDING_URGENCY_CAP_SECONDS) : 0;
  const spendingFontSizeRem = 1.8 + (3.6 - 1.8) * spendingUrgency;
  const spendingColor = lerpColor([217, 130, 43] /* amber */, [201, 79, 79] /* red-bright */, spendingUrgency);

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

  // Magnifying Glass holders get modifiers up front — see revealValue effect — so skip the blur reveal for them.
  const modifierRevealClass = currentRound?.item.revealedValue === undefined ? 'modifier-reveal' : '';

  return (
    <>
      {maxRounds !== null && (
        <div className="round-progress" aria-label={`Round ${roundNumber} of ${maxRounds}`}>
          {Array.from({ length: maxRounds }, (_, index) => (
            <span key={index} className={`round-dot${index < roundNumber ? ' complete' : ''}`} />
          ))}
        </div>
      )}
      {lastResult &&
        (() => {
          const hidden = getHiddenTrait(lastResult.item.hiddenTraitId);
          const winner = lastResult.round.winnerId
            ? players.find((player) => player.id === lastResult.round.winnerId)
            : undefined;
          const winningTime = lastResult.round.winnerId
            ? lastResult.round.bidders[lastResult.round.winnerId]?.committedMs ?? 0
            : 0;
          return (
            <div className="item-card">
              <h3 className="sold-title">{lastResult.round.winnerId ? 'SOLD' : 'PASSED'}</h3>
              <p className="item-meta">
                {getTemplate(lastResult.item.templateId)?.name} (
                <span className={`modifier ${modifierClass(lastResult.item.material)}`}>{lastResult.item.material}</span>
                {', '}
                <span className={`modifier ${modifierClass(lastResult.item.rarity)}`}>{lastResult.item.rarity}</span>
                {lastResult.item.specialModifier && (
                  <>
                    {', '}
                    <span className={`modifier ${modifierClass(lastResult.item.specialModifier)}`}>{lastResult.item.specialModifier}</span>
                  </>
                )}
                {')'}
              </p>
              {hidden && (
                <p className={`hidden-trait ${hidden.scoreBonus >= 0 ? 'positive' : 'negative'}`}>
                  {hidden.name} ({hidden.scoreBonus >= 0 ? '+$' : '-$'}
                  {Math.abs(hidden.scoreBonus)})
                </p>
              )}
              {winner ? (
                <div className="sold-details">
                  <div className="sold-detail winner-detail">
                    <span>Won by</span>
                    <PortraitIcon index={winner.portraitIndex} size={42} />
                    <strong>{winner.name}</strong>
                  </div>
                  <div className="sold-detail">
                    <span>Time Spent</span>
                    <strong>
                      {fmt(winningTime)}
                      {lastResult.round.soleBidder && <span className="sole-bidder-label">(Sole Bidder)</span>}
                    </strong>
                  </div>
                  <div className="sold-detail">
                    <span>True Value</span>
                    <strong>${lastResult.item.trueValue}</strong>
                  </div>
                </div>
              ) : (
                <>
                  <p className="item-meta">No one bid! Item goes unclaimed.</p>
                  <div className="sold-details passed-details">
                    <div className="sold-detail">
                      <span>True Value</span>
                      <strong>${lastResult.item.trueValue}</strong>
                    </div>
                  </div>
                </>
              )}
              <p className="next-lot-line">Next lot incoming…</p>
            </div>
          );
        })()}

      {!lastResult && currentRound && (
        <div className="item-card">
          <div className="item-sprite">
            <SpriteIcon index={Number(currentRound.item.visual.baseSpriteId)} scale={4} />
          </div>
          <h3 className="item-name">{getTemplate(currentRound.item.templateId)?.name}</h3>
          <div className="auction-details">
            <div>
              <p>Modifiers</p>
              <ul>
                {currentRound.item.material && (
                  <li className={`modifier ${modifierRevealClass} ${modifierClass(currentRound.item.material)}`}>
                    {currentRound.item.material} ×{getMaterialValueMultiplier(currentRound.item.material).toFixed(1)}
                  </li>
                )}
                {currentRound.item.rarity && (
                  <li className={`modifier ${modifierRevealClass} ${modifierClass(currentRound.item.rarity)}`}>
                    {currentRound.item.rarity} ×{getRarityValueMultiplier(currentRound.item.rarity).toFixed(1)}
                  </li>
                )}
                {currentRound.item.specialModifier && (
                  <li className={`modifier ${modifierRevealClass} ${modifierClass(currentRound.item.specialModifier)}`}>
                    {currentRound.item.specialModifier === 'Cursed' ? (
                      <span className="special-modifier-trigger">
                        {cursedSetActive ? 'Cursed x1.25' : 'Cursed ×0.75'}
                        <span className="special-modifier-tooltip"><b>CURSED SET BONUS</b><span className="set-bonus-tier silver">3: Change modifier to 1.25x</span></span>
                      </span>
                    ) : specialModifierLabel(currentRound.item.specialModifier)}
                  </li>
                )}
              </ul>
            </div>
            <div>
              <p>Attributes</p>
              <ul>
                {templateAttributes(getTemplate(currentRound.item.templateId), currentRound.item).map((attribute) => (
                  <li key={attribute.label}>
                    {attribute.tooltip ? (
                      <span className={`attribute-bonus-trigger${attribute.effect ? ' item-effect-label' : ''}`}>
                        {attribute.label}
                        <span className="attribute-bonus-tooltip"><b>{attribute.tooltip.title}</b><span>{attribute.tooltip.text}</span></span>
                      </span>
                    ) : <AttributeLabel {...attribute} />}
                  </li>
                ))}
              </ul>
            </div>
          </div>
          {getTemplate(currentRound.item.templateId)?.effectType === 'timeRefund' &&
            getTemplate(currentRound.item.templateId)?.timeRefund?.mode === 'catchup' && (
              <div className="item-effect-callout">Emergency Refund: Refunds time based on remaining time</div>
            )}
          <p className="item-meta">Value: {currentRound.item.revealedValue !== undefined ? `$${currentRound.item.revealedValue}` : '???'}</p>

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
                  {iHaveDropped ? 'WITHDRAWN' : iAmHolding ? (currentRound.round.bidWindowOpen ? 'CANCEL BID' : 'WITHDRAW') : 'BID'}
                </button>
              </>
            ))}
        </div>
      )}
      {showInitialBidTimer && (
        <div className="initial-bid-timer" role="status" aria-live="polite">
          <strong>-{initialBidSeconds.toFixed(1)}s</strong>
          <small>Bid before time runs out or this lot is passed.</small>
        </div>
      )}
      {showSpendingTimer && (
        <div className="initial-bid-timer" role="status" aria-live="polite">
          <strong style={{ fontSize: `${spendingFontSizeRem}rem`, color: spendingColor }}>
            {spendingSeconds!.toFixed(1)}s
          </strong>
          <small>Bidding is underway.</small>
        </div>
      )}
    </>
  );
}
