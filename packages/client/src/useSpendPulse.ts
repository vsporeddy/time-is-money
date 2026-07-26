import { useEffect, useState } from 'react';

// Shared by the coin cue's volume ramp, the portrait squash, and the timer's
// size/color ramp — how long a contest runs before urgency maxes out.
export const SPENDING_URGENCY_CAP_SECONDS = 30;

export interface SpendTick {
  // Increments once per second of spending. Consumers key animations/sounds
  // off this rather than a timestamp, so a mid-second re-render can't refire.
  count: number;
  // 0..1 ramp over SPENDING_URGENCY_CAP_SECONDS, sampled at the tick instant.
  urgency: number;
}

const IDLE: SpendTick = { count: 0, urgency: 0 };

// One 1s clock per round, anchored to the round's shared spending epoch, owned
// by App so both the coin cue (which only fires for your own spend) and the
// portrait squash (which covers every bidder you're allowed to see) run off the
// same beat. Keeping it here — rather than inside the component that plays the
// sound — is what lets the other portraits keep pulsing after you withdraw.
export function useSpendTick(spendingStartedAt: number | null | undefined, active: boolean): SpendTick {
  const [tick, setTick] = useState<SpendTick>(IDLE);

  useEffect(() => {
    if (!active || !spendingStartedAt) {
      setTick((current) => (current.count === 0 ? current : IDLE));
      return;
    }
    const fire = () => {
      const urgency = Math.min(1, (Date.now() - spendingStartedAt) / 1000 / SPENDING_URGENCY_CAP_SECONDS);
      setTick((current) => ({ count: current.count + 1, urgency }));
    };
    // Every bidder starts spending the instant the bid window closes, so firing
    // immediately here is already aligned to the round's second boundaries.
    fire();
    const interval = window.setInterval(fire, 1_000);
    return () => window.clearInterval(interval);
  }, [spendingStartedAt, active]);

  return tick;
}
