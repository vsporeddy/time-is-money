// The neural seat policy: a residual on the heuristic.
//
// The net never produces a reservation from scratch. It multiplies the
// heuristic's pre-cap figure by exp(tanh(logMult)) — bounded to [0.368, 2.718] —
// and applyReserveCaps still has the last word. Three consequences:
//   * zero weights reproduce today's bot exactly, so behavior cloning is free
//     and there is a hard floor under any regression;
//   * marginalItemScore is preserved, and it is the half of the heuristic that
//     is already near-optimal (it runs computeScores on the hypothetical stash);
//   * no policy output can make a bot bid itself out of the game.

import type { Player } from 'shared';
import { __botInternals } from '../../src/bots.js';
import { buildObservation, OBS_DIM } from '../../src/botPolicy/features.js';
import { MlpPolicy, residualMultiplier, sigmoid } from '../../src/botPolicy/policy.js';
import type { PolicyWeights } from '../../src/botPolicy/policy.js';
import type { Room } from '../../src/rooms.js';
import type { DecisionContext, SeatDecision, SeatPolicy } from './sim.js';
import { ECONOMY } from './sim.js';

const { applyReserveCaps, botVisibleItem } = __botInternals;

export const HIDDEN_LAYERS = [64, 32];
export const LAYER_SIZES = [OBS_DIM, ...HIDDEN_LAYERS, 2];

export interface Transition {
  obs: Float32Array;
  logMultSample: number;
  logMultMean: number;
  entered: number; // 1 or 0
  entryProb: number;
  seat: number;
}

export interface Recorder {
  transitions: Transition[];
}

function gaussian(): number {
  const u = Math.max(Number.EPSILON, Math.random());
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * Math.random());
}

export function makeObsContext(room: Room, player: Player, ctx: DecisionContext) {
  const visibleItem = botVisibleItem(room, player);
  return visibleItem
    ? {
        room,
        player,
        visibleItem,
        revealed: new Set(room.activeRound?.round.revealedFields ?? []),
        assumedPriceMs: ctx.perLot,
        heuristicWillingMs: ctx.heuristicWilling,
        marginalScore: ctx.marginal,
        expectedLot: ctx.expected,
        perLotMs: ctx.perLot,
        // One appraisal per bot per lot, so this is the round index — computed
        // the same way at training and at runtime to avoid train/serve skew.
        lotObservationCount: room.currentRoundIndex + 1,
      }
    : undefined;
}

export interface NnPolicyOptions {
  seat: number;
  logStd: number;
  stochastic: boolean; // sample for training; threshold for evaluation
  recorder?: Recorder;
}

export function nnPolicy(
  weights: PolicyWeights,
  options: NnPolicyOptions,
  name = 'nn'
): SeatPolicy {
  const model = new MlpPolicy(weights);
  const scratch = new Float32Array(OBS_DIM);

  return {
    name,
    decide(room: Room, player: Player, ctx: DecisionContext): SeatDecision {
      if (ctx.marginal <= 0 || ctx.heuristicWilling <= 0) {
        return { enter: false, reservationMs: 0 };
      }
      const obsContext = makeObsContext(room, player, ctx);
      if (!obsContext) return { enter: false, reservationMs: 0 };

      const obs = buildObservation(obsContext, scratch);
      const { logMult, entryLogit } = model.forward(obs);

      const sampled = options.stochastic
        ? logMult + Math.exp(options.logStd) * gaussian()
        : logMult;
      const entryProb = sigmoid(entryLogit);
      const enterDraw = options.stochastic ? Math.random() < entryProb : entryProb > 0.5;

      const willing = ctx.heuristicWilling * residualMultiplier(sampled);
      const reserve = applyReserveCaps(player, willing);

      // The sole-bidder floor is a rule fact the net does not get to override:
      // an uncontested win costs a flat SOLE_BIDDER_PRICE_MS regardless, so
      // entering below it is a guaranteed loss.
      const allowed = reserve >= ECONOMY.SOLE_BIDDER_PRICE_MS;
      const entered = allowed && enterDraw;

      if (options.recorder) {
        options.recorder.transitions.push({
          obs: obs.slice(),
          logMultSample: sampled,
          logMultMean: logMult,
          entered: entered ? 1 : 0,
          entryProb,
          seat: options.seat,
        });
      }

      return entered ? { enter: true, reservationMs: reserve } : { enter: false, reservationMs: 0 };
    },
  };
}

// Zero weights => residualMultiplier(0) = e^tanh(0) = 1 => the heuristic exactly.
// Used as the initial policy and as the regression floor in the ablation.
export function zeroWeights(obsMean: number[], obsStd: number[]): PolicyWeights {
  return {
    obsDim: OBS_DIM,
    layers: LAYER_SIZES,
    obsMean,
    obsStd,
    w: LAYER_SIZES.slice(0, -1).map((inSize, i) => new Array(inSize * LAYER_SIZES[i + 1]).fill(0)),
    b: LAYER_SIZES.slice(1).map((outSize) => new Array(outSize).fill(0)),
  };
}
