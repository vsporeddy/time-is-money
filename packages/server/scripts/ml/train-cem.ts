// Phase 2: cross-entropy method over the eight bidding scalars.
//
//   npx tsx scripts/ml/train-cem.ts [iterations]
//
// Pure self-play, as chosen: each episode seats four candidates drawn from the
// current population, so a candidate's fitness is its margin against its peers.
// That is competitive coevolution rather than degenerate self-play — the
// opponents genuinely differ, so relative fitness carries signal.
//
// Co-degradation is the failure mode this cannot see from the inside: if every
// candidate shades toward zero together, margins stay meaningful and the search
// looks healthy while the population gets worse. The anchor evaluation against
// frozen heuristic seats runs every iteration purely to detect that. It is
// never a training signal.

import { evaluate } from './env.js';
import { heuristicPolicy, runEpisode, SEATS } from './sim.js';
import type { SeatPolicy } from './sim.js';
import {
  DEFAULT_SCALARS,
  fromVector,
  SCALAR_BOUNDS,
  SCALAR_KEYS,
  scalarPolicy,
  toVector,
} from './scalars.js';

const ITERATIONS = Number(process.argv[2] ?? 60);
const POPULATION = 32;
const ELITE = 8;
const EPISODES_PER_ITERATION = 4_096;
const ANCHOR_SEEDS = 150;

// --- identity check ----------------------------------------------------------
// The scalar policy reimplements the heuristic's formula. If the identity
// vector does not reproduce it exactly, every improvement measured below is
// measuring the reimplementation, not the search.
{
  const identity = scalarPolicy(DEFAULT_SCALARS, 'identity');
  let mismatch = 0;
  for (let seed = 0; seed < 60; seed += 1) {
    const a = runEpisode(seed, Array.from({ length: SEATS }, () => heuristicPolicy));
    const b = runEpisode(seed, Array.from({ length: SEATS }, () => identity));
    for (let seat = 0; seat < SEATS; seat += 1) {
      if (a.scores[seat].total !== b.scores[seat].total) mismatch += 1;
    }
  }
  if (mismatch > 0) {
    console.error(`identity check FAILED: ${mismatch}/${60 * SEATS} seat scores differ`);
    console.error('scalarPolicy(DEFAULT_SCALARS) must be bit-identical to heuristicPolicy.');
    process.exit(1);
  }
  console.log(`identity check passed (${60 * SEATS} seat scores match)\n`);
}

// --- CEM ---------------------------------------------------------------------

function gaussian(): number {
  const u = Math.max(Number.EPSILON, Math.random());
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * Math.random());
}

const dim = SCALAR_KEYS.length;
let mean = toVector(DEFAULT_SCALARS);
// Start at a quarter of each parameter's search range — wide enough to escape
// the incumbent, narrow enough that the first generation isn't all nonsense.
let std = SCALAR_KEYS.map((key) => {
  const [lo, hi] = SCALAR_BOUNDS[key];
  return (hi - lo) * 0.25;
});

const anchorSeeds = Array.from({ length: ANCHOR_SEEDS }, (_, i) => 9_000_000 + i);
let best = { fitness: -Infinity, vector: [...mean], anchorMargin: 0 };

for (let iteration = 1; iteration <= ITERATIONS; iteration += 1) {
  const candidates = Array.from({ length: POPULATION }, (_, index) => {
    const vector = index === 0
      ? [...mean] // always carry the current mean, so a generation can't lose ground
      : mean.map((mu, d) => mu + std[d] * gaussian());
    return { vector, policy: scalarPolicy(fromVector(vector), `cand${index}`), sum: 0, n: 0 };
  });

  const episodes = Math.ceil(EPISODES_PER_ITERATION / SEATS) * SEATS;
  for (let e = 0; e < episodes; e += 1) {
    // Draw SEATS distinct candidates for this table.
    const table: number[] = [];
    while (table.length < SEATS) {
      const pick = (Math.random() * POPULATION) | 0;
      if (!table.includes(pick)) table.push(pick);
    }
    const seed = iteration * 1_000_003 + e;
    const result = runEpisode(seed, table.map((index) => candidates[index].policy));
    const totals = result.scores.map((score) => score.total);
    const meanTotal = totals.reduce((sum, value) => sum + value, 0) / totals.length;
    table.forEach((index, seat) => {
      candidates[index].sum += totals[seat] - meanTotal;
      candidates[index].n += 1;
    });
  }

  const ranked = candidates
    .map((candidate) => ({ ...candidate, fitness: candidate.sum / Math.max(1, candidate.n) }))
    .sort((a, b) => b.fitness - a.fitness);
  const elites = ranked.slice(0, ELITE);

  mean = Array.from({ length: dim }, (_, d) =>
    elites.reduce((sum, elite) => sum + elite.vector[d], 0) / ELITE
  );
  std = Array.from({ length: dim }, (_, d) => {
    const variance =
      elites.reduce((sum, elite) => sum + (elite.vector[d] - mean[d]) ** 2, 0) / ELITE;
    // Noise floor so the search cannot collapse to a point in early iterations.
    const [lo, hi] = SCALAR_BOUNDS[SCALAR_KEYS[d]];
    return Math.max(Math.sqrt(variance), (hi - lo) * 0.01);
  });

  // Anchor: current mean vs three frozen heuristics. Diagnostic only.
  const anchorPolicies: SeatPolicy[] = [
    scalarPolicy(fromVector(mean), 'anchor'),
    heuristicPolicy,
    heuristicPolicy,
    heuristicPolicy,
  ];
  const anchor = evaluate(anchorSeeds, anchorPolicies);
  const anchorMargin = anchor.seats[0].meanMargin;

  // CEM converges, so the final mean is the answer — selecting on peak
  // self-play fitness would just pick whichever early generation happened to
  // have the most spread-out population. The anchor is recorded alongside for
  // diagnosis and never used to choose.
  best = { fitness: ranked[0].fitness, vector: [...mean], anchorMargin };

  console.log(
    `iter ${String(iteration).padStart(3)}` +
    `  selfPlayFitness ${ranked[0].fitness.toFixed(2).padStart(7)}` +
    `  anchorMargin ${anchorMargin.toFixed(2).padStart(7)}` +
    `  anchorWin ${(anchor.seats[0].winRate * 100).toFixed(1).padStart(5)}%` +
    `  price/item ${(anchor.seats[0].meanPricePerItem / 1000).toFixed(2)}s`
  );
}

const tuned = fromVector(best.vector);
console.log('\n=== tuned scalars ===');
for (const key of SCALAR_KEYS) {
  console.log(`  ${key.padEnd(22)} ${DEFAULT_SCALARS[key].toFixed(3).padStart(9)}  ->  ${tuned[key].toFixed(3).padStart(9)}`);
}
console.log(`\n  anchor margin vs 3 heuristics: ${best.anchorMargin.toFixed(2)} points`);
console.log(`  ${JSON.stringify(tuned)}`);
