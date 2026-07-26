// Fidelity check: abstract simulator vs the real timer-driven loop.
//
//   npx tsx scripts/bot-game-sim.ts 40 > calibration.log
//   npx tsx scripts/ml/calibrate.ts calibration.log
//
// bot-game-sim.ts runs the genuine startGame/tickRoom state machine and emits a
// CALIBRATION json line per game. This replays the same seat count through the
// abstract simulator and compares the distributions that matter. If these do not
// match, nothing downstream means anything — the policy would be optimizing a
// game that isn't the one being shipped.

import { readFileSync } from 'node:fs';
import { heuristicPolicy, runEpisode } from './sim.js';

interface CalibrationRow {
  rounds: number;
  contested: number;
  passed: number;
  stalemates: number;
  holds: number[];
  scores: number[];
  items: number[];
  timeLeft: number[];
}

const path = process.argv[2];
if (!path) {
  console.error('usage: npx tsx scripts/ml/calibrate.ts <bot-game-sim output>');
  process.exit(1);
}

const real: CalibrationRow[] = readFileSync(path, 'utf8')
  .split('\n')
  .filter((line) => line.startsWith('CALIBRATION '))
  .map((line) => JSON.parse(line.slice('CALIBRATION '.length)));

if (real.length === 0) {
  console.error(`no CALIBRATION lines in ${path}`);
  process.exit(1);
}

const seatCount = real[0].scores.length;
const games = real.length;

// Match the real harness seat-for-seat.
const abstract_ = Array.from({ length: Math.max(games, 400) }, (_, i) =>
  runEpisode(5_000_000 + i, Array.from({ length: seatCount }, () => heuristicPolicy))
);

function mean(values: number[]): number {
  return values.reduce((sum, value) => sum + value, 0) / Math.max(1, values.length);
}

// Two-sample Kolmogorov-Smirnov statistic. Distribution-free, and the shape
// mismatches that matter here (a hold distribution piled at the cap, say) show
// up in D where a mean comparison would not.
function ksStatistic(a: number[], b: number[]): number {
  const x = [...a].sort((p, q) => p - q);
  const y = [...b].sort((p, q) => p - q);
  let i = 0;
  let j = 0;
  let d = 0;
  while (i < x.length && j < y.length) {
    const value = Math.min(x[i], y[j]);
    while (i < x.length && x[i] <= value) i += 1;
    while (j < y.length && y[j] <= value) j += 1;
    d = Math.max(d, Math.abs(i / x.length - j / y.length));
  }
  return d;
}

const realStats = {
  contestedRate: mean(real.map((row) => row.contested / row.rounds)),
  passedRate: mean(real.map((row) => row.passed / row.rounds)),
  stalemates: real.reduce((sum, row) => sum + row.stalemates, 0),
  holds: real.flatMap((row) => row.holds),
  scores: real.flatMap((row) => row.scores),
  items: real.flatMap((row) => row.items),
  timeLeft: real.flatMap((row) => row.timeLeft),
};

const abstractStats = {
  contestedRate: mean(abstract_.map((row) => row.contestedRounds / Math.max(1, row.roundsPlayed))),
  passedRate: mean(abstract_.map((row) => row.passedRounds / Math.max(1, row.roundsPlayed))),
  stalemates: 0,
  holds: abstract_.flatMap((row) => row.holds),
  scores: abstract_.flatMap((row) => row.scores.map((score) => score.total)),
  items: abstract_.flatMap((row) => row.itemsWon),
  timeLeft: abstract_.flatMap((row) => row.finalTimeMs),
};

console.log(`=== calibration: ${games} real games vs ${abstract_.length} abstract, ${seatCount} seats ===\n`);
console.log('  metric              real     abstract     delta');
const scalars: [string, number, number][] = [
  ['contested rate', realStats.contestedRate, abstractStats.contestedRate],
  ['passed rate', realStats.passedRate, abstractStats.passedRate],
  ['mean score', mean(realStats.scores), mean(abstractStats.scores)],
  ['mean items won', mean(realStats.items), mean(abstractStats.items)],
  ['mean time left (s)', mean(realStats.timeLeft) / 1000, mean(abstractStats.timeLeft) / 1000],
  ['mean hold (s)', mean(realStats.holds) / 1000, mean(abstractStats.holds) / 1000],
];
for (const [label, a, b] of scalars) {
  console.log(
    `  ${label.padEnd(20)} ${a.toFixed(3).padStart(7)}  ${b.toFixed(3).padStart(9)}  ${(b - a).toFixed(3).padStart(8)}`
  );
}

console.log('\n  distribution            KS D    verdict');
const distributions: [string, number[], number[]][] = [
  ['holds', realStats.holds, abstractStats.holds],
  ['scores', realStats.scores, abstractStats.scores],
  ['items won', realStats.items, abstractStats.items],
  ['time left', realStats.timeLeft, abstractStats.timeLeft],
];
let worst = 0;
for (const [label, a, b] of distributions) {
  const d = ksStatistic(a, b);
  worst = Math.max(worst, d);
  console.log(`  ${label.padEnd(22)} ${d.toFixed(3)}    ${d < 0.1 ? 'ok' : d < 0.2 ? 'marginal' : 'MISMATCH'}`);
}

console.log(`\n  stalemates: real ${realStats.stalemates}, abstract ${abstractStats.stalemates} (must both be 0)`);
console.log(
  worst < 0.1 && realStats.stalemates === 0
    ? '\n  PASS'
    : `\n  ${worst < 0.2 ? 'MARGINAL' : 'FAIL'} — worst KS D = ${worst.toFixed(3)}`
);
