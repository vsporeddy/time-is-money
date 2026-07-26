// The comparison that decides what ships.
//
//   npx tsx scripts/ml/ablation.ts [seeds]
//
// Three contenders, each seated against three frozen heuristics on the same
// held-out seeds:
//   (i)   the current heuristic — the incumbent, and the zero point
//   (ii)  the CEM-tuned scalars — ~150 lines, no dependencies
//   (iii) the residual policy net — TensorFlow, 8.9k parameters
//
// Acceptance rule, fixed in advance: if (iii) does not beat (ii) by more than
// one bootstrap standard error, ship (ii) and delete the net. Deciding this
// after seeing the numbers is how projects end up shipping a neural network
// that a multiply-by-1.2 would have matched.
//
// Seeds here are disjoint from every training range: CEM uses iteration*1e6+e,
// REINFORCE uses update*7919+e, warmup uses 2e6+, anchors use 8e6+/9e6+.

import { bootstrapCI, evaluate } from './env.js';
import { heuristicPolicy } from './sim.js';
import type { SeatPolicy } from './sim.js';
import { fromVector, scalarPolicy, SCALAR_KEYS, toVector } from './scalars.js';
import type { ScalarParams } from './scalars.js';
import { nnPolicy } from './nn.js';
import type { PolicyWeights } from '../../src/botPolicy/policy.js';

const seedCount = Number(process.argv[2] ?? 1_500);
const seeds = Array.from({ length: seedCount }, (_, i) => 7_654_321 + i);

// Result of `npx tsx scripts/ml/train-cem.ts 60`.
const TUNED_SCALARS: ScalarParams = {
  aggressionScale: 1.0107963588374669,
  competitionBiasScale: 1.1478168442658843,
  reserveFactorScale: 1.329009985176707,
  entryThresholdScale: 0.8746269406272981,
  lateGameSlope: 0.7401158979582015,
  absoluteCapMs: 18_000,
  budgetCapFloorMs: 562.117654972835,
  valueExponent: 1.262351837980153,
};

interface Contender {
  label: string;
  policy: SeatPolicy;
}

const contenders: Contender[] = [
  { label: '(i)   heuristic', policy: heuristicPolicy },
  { label: '(ii)  CEM scalars', policy: scalarPolicy(fromVector(toVector(TUNED_SCALARS)), 'cem') },
];

// The net is optional: the ablation must run before it exists, so a missing or
// stale weights module is a skip, not a crash.
try {
  const generated = await import('../../src/botPolicy/weights.generated.js');
  const features = await import('../../src/botPolicy/features.js');
  if (generated.POLICY_META.featureNamesHash !== features.featureNamesHash()) {
    console.log('  (net skipped: featureNamesHash mismatch — encoder changed since training)\n');
  } else {
    const weights: PolicyWeights = {
      obsDim: generated.POLICY_META.obsDim,
      layers: [...generated.POLICY_META.layers],
      obsMean: generated.OBS_MEAN,
      obsStd: generated.OBS_STD,
      w: generated.W,
      b: generated.B,
    };
    contenders.push({
      label: '(iii) policy net',
      policy: nnPolicy(weights, { seat: 0, logStd: -Infinity, stochastic: false }, 'nn'),
    });
  }
} catch {
  console.log('  (net skipped: no weights.generated.ts yet)\n');
}

console.log(`=== ablation: ${seedCount} held-out seeds x 4 rotations, vs 3 frozen heuristics ===\n`);
console.log('  contender           margin (95% CI)            win%   score  items  price/item  entry  outOfTime');

const results: { label: string; margin: number; samples: number[] }[] = [];
for (const contender of contenders) {
  const summary = evaluate(seeds, [contender.policy, heuristicPolicy, heuristicPolicy, heuristicPolicy]);
  const seat = summary.seats[0];
  const [lo, hi] = bootstrapCI(seat.marginSamples);
  results.push({ label: contender.label, margin: seat.meanMargin, samples: seat.marginSamples });
  console.log(
    `  ${contender.label.padEnd(18)}` +
    ` ${seat.meanMargin.toFixed(2).padStart(6)} [${lo.toFixed(2)}, ${hi.toFixed(2)}]`.padEnd(26) +
    ` ${(seat.winRate * 100).toFixed(1).padStart(5)}%` +
    ` ${seat.meanScore.toFixed(1).padStart(7)}` +
    ` ${seat.meanItemsWon.toFixed(2).padStart(6)}` +
    ` ${(seat.meanPricePerItem / 1000).toFixed(2).padStart(10)}s` +
    ` ${(seat.entryRate * 100).toFixed(0).padStart(5)}%` +
    ` ${(seat.outOfTimeRate * 100).toFixed(1).padStart(9)}%`
  );
}

function standardError(samples: number[]): number {
  const mean = samples.reduce((sum, value) => sum + value, 0) / samples.length;
  const variance = samples.reduce((sum, value) => sum + (value - mean) ** 2, 0) / samples.length;
  return Math.sqrt(variance / samples.length);
}

const cem = results.find((r) => r.label.includes('CEM'));
const net = results.find((r) => r.label.includes('net'));

console.log('\n=== verdict ===');
if (!net || !cem) {
  console.log('  net not available — nothing to decide yet.');
} else {
  const delta = net.margin - cem.margin;
  const se = Math.sqrt(standardError(net.samples) ** 2 + standardError(cem.samples) ** 2);
  console.log(`  net - CEM = ${delta.toFixed(2)} points, combined SE = ${se.toFixed(2)}`);
  console.log(
    delta > se
      ? `  SHIP THE NET — it clears the CEM baseline by ${(delta / se).toFixed(1)} SE.`
      : `  SHIP THE CEM SCALARS — the net adds ${delta.toFixed(2)} points, inside noise (${(delta / se).toFixed(1)} SE).\n` +
        '  The scalar diff is ~8 numbers in bots.ts and carries no TensorFlow dependency.'
  );
}

// Regression guards. These are correctness, not tuning, so they fail the run.
const failures: string[] = [];
for (const contender of contenders) {
  const summary = evaluate(seeds.slice(0, 300), [
    contender.policy, heuristicPolicy, heuristicPolicy, heuristicPolicy,
  ]);
  const seat = summary.seats[0];
  const baseline = summary.seats[1];
  if (seat.entryRate < baseline.entryRate * 0.5 || seat.entryRate > baseline.entryRate * 1.5) {
    failures.push(`${contender.label}: entry rate ${(seat.entryRate * 100).toFixed(0)}% outside [0.5x, 1.5x] of heuristic`);
  }
  if (seat.outOfTimeRate > baseline.outOfTimeRate + 0.05) {
    failures.push(`${contender.label}: out-of-time rate ${(seat.outOfTimeRate * 100).toFixed(1)}% worse than heuristic`);
  }
}
console.log(
  failures.length === 0
    ? '\n  regression guards: PASS'
    : `\n  regression guards: FAIL\n${failures.map((f) => `    - ${f}`).join('\n')}`
);

console.log(`\n  CEM scalars: ${SCALAR_KEYS.map((k) => `${k}=${TUNED_SCALARS[k].toFixed(3)}`).join(' ')}`);
