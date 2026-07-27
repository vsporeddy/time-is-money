// Evaluation harness and the symmetry gate.
//
//   npx tsx scripts/ml/eval.ts [seeds]
//
// With every seat playing the same policy, each seat must land on a 1/SEATS win
// rate and a zero mean margin. Anything else means seat asymmetry leaked in
// (focusTraitForBot assigns a trait family by player index) and every downstream
// number would be measuring that instead of the policy.

import { bootstrapCI, evaluate } from './env.js';
import { heuristicPolicy, SEATS } from './sim.js';

const seedCount = Number(process.argv[2] ?? 400);
const seeds = Array.from({ length: seedCount }, (_, i) => 1_000_000 + i);

const started = Date.now();
const summary = evaluate(seeds, [heuristicPolicy]);
const elapsedMs = Date.now() - started;
const episodes = seedCount * SEATS;

console.log(`=== symmetry gate: ${heuristicPolicy.name} in all ${SEATS} seats ===`);
console.log(
  `  ${episodes} episodes in ${(elapsedMs / 1000).toFixed(1)}s ` +
  `(${(episodes / (elapsedMs / 1000)).toFixed(0)} episodes/sec)`
);
console.log(
  `  rounds/game ${summary.roundsPlayed.toFixed(1)}   ` +
  `contested ${(summary.contestedRate * 100).toFixed(1)}%   ` +
  `passed ${(summary.passedRate * 100).toFixed(1)}%`
);

console.log('\n  policy      winRate   margin (95% CI)          score  items  price/item  entry  left');
for (const [index, seat] of summary.seats.entries()) {
  const [lo, hi] = bootstrapCI(seat.marginSamples);
  console.log(
    `  #${index}` +
    `  ${seat.winRate.toFixed(3).padStart(9)}` +
    `  ${seat.meanMargin.toFixed(2).padStart(7)} [${lo.toFixed(2)}, ${hi.toFixed(2)}]`.padEnd(28) +
    `  ${seat.meanScore.toFixed(1).padStart(5)}` +
    `  ${seat.meanItemsWon.toFixed(2).padStart(5)}` +
    `  ${(seat.meanPricePerItem / 1000).toFixed(2).padStart(9)}s` +
    `  ${(seat.entryRate * 100).toFixed(0).padStart(4)}%` +
    `  ${(seat.meanFinalTimeMs / 1000).toFixed(1).padStart(5)}s`
  );
}

// The gate itself. Only one policy was supplied, so every seat aggregates into
// stats[0] — a per-seat breakdown would need distinct policy objects, which is
// what the ablation in the training scripts does.
const seat = summary.seats[0];
const [lo, hi] = bootstrapCI(seat.marginSamples);
const expectedWinRate = 1 / SEATS;

const failures: string[] = [];
if (Math.abs(seat.winRate - expectedWinRate) > 0.02) {
  failures.push(`win rate ${seat.winRate.toFixed(3)} != ${expectedWinRate} (self-play must be symmetric)`);
}
if (lo > 0 || hi < 0) failures.push(`margin CI [${lo.toFixed(2)}, ${hi.toFixed(2)}] excludes zero`);
if (summary.passedRate > 0.5) failures.push(`${(summary.passedRate * 100).toFixed(0)}% of lots went unbid`);

console.log(
  failures.length === 0
    ? '\n  PASS — symmetric, margin CI covers zero'
    : `\n  FAIL\n${failures.map((f) => `    - ${f}`).join('\n')}`
);
process.exit(failures.length === 0 ? 0 : 1);
