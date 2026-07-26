// The eight-scalar parameterization of the existing bidding heuristic.
//
// This is the control the neural net has to beat. It rebuilds reservationMs
// (bots.ts:286-314) from its own parameters rather than mutating bots.ts, so
// the search never touches production code — a winning vector ships later as a
// deliberate diff to BOT_PERSONALITIES and the constants.
//
// DEFAULT_SCALARS must reproduce the heuristic exactly. That is asserted in
// train-cem.ts before the search starts: if the identity vector doesn't match,
// every measured improvement is measuring the reimplementation instead.

import type { Player } from 'shared';
import { __botInternals } from '../../src/bots.js';
import type { Room } from '../../src/rooms.js';
import type { DecisionContext, SeatDecision, SeatPolicy } from './sim.js';
import { ECONOMY } from './sim.js';

const { personalityFor, applyReserveCaps } = __botInternals;

export interface ScalarParams {
  aggressionScale: number; // multiplies personality.aggression
  competitionBiasScale: number; // multiplies personality.competitionBias
  reserveFactorScale: number; // multiplies personality.reserveFactor (the soft budget cap)
  entryThresholdScale: number; // multiplies personality.entryThresholdRatio
  lateGameSlope: number; // the 0.35 in lateGameFactor = 1 + progress * slope
  absoluteCapMs: number; // soft mirror of ABSOLUTE_RESERVE_CAP_MS; only ever binds downward
  budgetCapFloorMs: number; // the 1_000 floor under the soft budget cap
  valueExponent: number; // desired ∝ value^exponent — the all-pay shading knob
}

export const DEFAULT_SCALARS: ScalarParams = {
  aggressionScale: 1,
  competitionBiasScale: 1,
  reserveFactorScale: 1,
  entryThresholdScale: 1,
  lateGameSlope: 0.35,
  absoluteCapMs: 18_000,
  budgetCapFloorMs: 1_000,
  valueExponent: 1,
};

export const SCALAR_KEYS = Object.keys(DEFAULT_SCALARS) as (keyof ScalarParams)[];

// Search bounds. absoluteCapMs is capped at the production constant because
// applyReserveCaps still clamps there — raising it here would be a silent no-op,
// and raising it for real is a balance decision, not a tuning one.
export const SCALAR_BOUNDS: Record<keyof ScalarParams, [number, number]> = {
  aggressionScale: [0.3, 2.5],
  competitionBiasScale: [-3, 3],
  reserveFactorScale: [0.3, 2.5],
  entryThresholdScale: [0.2, 3],
  lateGameSlope: [-0.5, 1.5],
  absoluteCapMs: [4_000, 18_000],
  budgetCapFloorMs: [0, 6_000],
  valueExponent: [0.4, 2],
};

export function toVector(params: ScalarParams): number[] {
  return SCALAR_KEYS.map((key) => params[key]);
}

export function fromVector(vector: number[]): ScalarParams {
  const params = { ...DEFAULT_SCALARS };
  SCALAR_KEYS.forEach((key, index) => {
    const [lo, hi] = SCALAR_BOUNDS[key];
    params[key] = Math.min(hi, Math.max(lo, vector[index]));
  });
  return params;
}

function competitionFactor(room: Room, player: Player, params: ScalarParams): number {
  const activeCompetitors = room.activeRound
    ? Object.values(room.activeRound.round.bidders).filter((bidder) => bidder.isHolding).length
    : 1;
  const rivals = Math.max(0, activeCompetitors - 1);
  const bias = personalityFor(room, player).competitionBias * params.competitionBiasScale;
  return Math.min(1.25, Math.max(0.6, 1 + bias * rivals));
}

export function scalarPolicy(params: ScalarParams, name = 'scalars'): SeatPolicy {
  return {
    name,
    decide(room: Room, player: Player, ctx: DecisionContext): SeatDecision {
      const personality = personalityFor(room, player);
      const value = ctx.marginal;

      if (value <= 0) return { enter: false, reservationMs: 0 };

      const msPerPoint = ctx.perLot / Math.max(1, ctx.expected);
      const remainingLots = Math.max(1, room.roundsToPlay - room.currentRoundIndex);
      const progress = 1 - remainingLots / Math.max(1, room.roundsToPlay);
      const lateGameFactor = 1 + progress * params.lateGameSlope;

      const desired =
        Math.pow(value, params.valueExponent) *
        msPerPoint *
        personality.aggression * params.aggressionScale *
        lateGameFactor *
        competitionFactor(room, player, params);

      const budgetCap = Math.max(
        params.budgetCapFloorMs,
        ctx.perLot * personality.reserveFactor * params.reserveFactorScale * lateGameFactor
      );
      const willing = Math.min(desired, budgetCap) * ctx.nerveMultiplier;

      // The tuned cap binds first, then the two production hard caps. Ordering
      // matters: applyReserveCaps must always be the last word.
      const reserve = applyReserveCaps(player, Math.min(willing, params.absoluteCapMs));

      const threshold = personality.entryThresholdRatio * params.entryThresholdScale * ctx.expected;
      const confidence = Math.min(
        0.95,
        Math.max(0.1, 0.5 + (value - threshold) / (2 * Math.max(1, ctx.expected)))
      );

      if (reserve < ECONOMY.SOLE_BIDDER_PRICE_MS || Math.random() > confidence) {
        return { enter: false, reservationMs: 0 };
      }
      return { enter: true, reservationMs: reserve };
    },
  };
}
