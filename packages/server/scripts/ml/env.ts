// Episode aggregation: seat rotation, fitness, and summary statistics.
//
// Seat rotation is the reason a measured margin means anything. focusTraitForBot
// (bots.ts:163-168) assigns each bot one of the game's three main trait families
// by its index in the player list, so seat 0 and seat 3 are not symmetric. Every
// evaluation therefore runs each seed once per rotation and averages, which
// cancels the seat bias exactly.

import type { SeatPolicy } from './sim.js';
import { runEpisode, SEATS } from './sim.js';

export interface SeatStats {
  episodes: number;
  meanScore: number;
  meanMargin: number; // score minus the mean of all seats in the same episode
  winRate: number;
  meanItemsWon: number;
  meanPricePerItem: number;
  meanCommittedMs: number;
  meanFinalTimeMs: number;
  entryRate: number;
  outOfTimeRate: number;
  marginSamples: number[]; // kept for bootstrap CIs
}

export interface EvalSummary {
  seats: SeatStats[];
  roundsPlayed: number;
  contestedRate: number;
  passedRate: number;
}

export function evaluate(seeds: number[], policies: SeatPolicy[]): EvalSummary {
  const stats: SeatStats[] = Array.from({ length: SEATS }, () => ({
    episodes: 0,
    meanScore: 0,
    meanMargin: 0,
    winRate: 0,
    meanItemsWon: 0,
    meanPricePerItem: 0,
    meanCommittedMs: 0,
    meanFinalTimeMs: 0,
    entryRate: 0,
    outOfTimeRate: 0,
    marginSamples: [],
  }));

  let roundsPlayed = 0;
  let contested = 0;
  let passed = 0;
  let episodes = 0;

  for (const seed of seeds) {
    for (let rotation = 0; rotation < SEATS; rotation += 1) {
      const seated = Array.from(
        { length: SEATS },
        (_, seat) => policies[(seat + rotation) % policies.length]
      );
      const episode = runEpisode(seed, seated);
      episodes += 1;
      roundsPlayed += episode.roundsPlayed;
      contested += episode.contestedRounds;
      passed += episode.passedRounds;

      const totals = episode.scores.map((score) => score.total);
      const meanTotal = totals.reduce((sum, value) => sum + value, 0) / totals.length;
      const best = Math.max(...totals);

      for (let seat = 0; seat < SEATS; seat += 1) {
        // Attribute back to the policy index, not the physical seat.
        const policyIndex = (seat + rotation) % policies.length;
        const target = stats[policyIndex];
        target.episodes += 1;
        target.meanScore += totals[seat];
        target.meanMargin += totals[seat] - meanTotal;
        target.marginSamples.push(totals[seat] - meanTotal);
        target.winRate += totals[seat] === best ? 1 / totals.filter((t) => t === best).length : 0;
        target.meanItemsWon += episode.itemsWon[seat];
        target.meanPricePerItem +=
          episode.itemsWon[seat] > 0 ? episode.pricePaidMs[seat] / episode.itemsWon[seat] : 0;
        target.meanCommittedMs += episode.committedMs[seat];
        target.meanFinalTimeMs += episode.finalTimeMs[seat];
        target.entryRate += episode.roundsPlayed > 0 ? episode.entries[seat] / episode.roundsPlayed : 0;
        target.outOfTimeRate += episode.finalTimeMs[seat] <= 0 ? 1 : 0;
      }
    }
  }

  for (const seat of stats) {
    const n = Math.max(1, seat.episodes);
    seat.meanScore /= n;
    seat.meanMargin /= n;
    seat.winRate /= n;
    seat.meanItemsWon /= n;
    seat.meanPricePerItem /= n;
    seat.meanCommittedMs /= n;
    seat.meanFinalTimeMs /= n;
    seat.entryRate /= n;
    seat.outOfTimeRate /= n;
  }

  return {
    seats: stats,
    roundsPlayed: roundsPlayed / Math.max(1, episodes),
    contestedRate: contested / Math.max(1, roundsPlayed),
    passedRate: passed / Math.max(1, roundsPlayed),
  };
}

// Percentile bootstrap over episode-level margins. The effect being measured is
// a few points on a distribution with sigma around 50, so a point estimate on
// its own is not reportable.
export function bootstrapCI(samples: number[], resamples = 2_000, alpha = 0.05): [number, number] {
  if (samples.length === 0) return [0, 0];
  const means: number[] = [];
  for (let i = 0; i < resamples; i += 1) {
    let sum = 0;
    for (let j = 0; j < samples.length; j += 1) {
      sum += samples[(Math.random() * samples.length) | 0];
    }
    means.push(sum / samples.length);
  }
  means.sort((a, b) => a - b);
  return [
    means[Math.floor(means.length * (alpha / 2))],
    means[Math.min(means.length - 1, Math.floor(means.length * (1 - alpha / 2)))],
  ];
}
