// Wall-clock-free episode simulator.
//
// The real loop (round.ts) is timer-driven: bot-game-sim.ts ticks a 100ms
// setInterval and a 15-round game costs ~75 real seconds. Training needs 10^5+
// episodes, so this replaces the state machine — and only the state machine.
// Everything else is the production code: createRoomObject, buildLotPool,
// rollItemInstanceForTemplate, computeScores, tryOpenChests, computeTimeRefund,
// and the bot's own reservationMs/marginalItemScore via __botInternals. The
// Room here is a real Room; it just never grows an ActiveRound with timers on
// it.
//
// This is sound because the resolution rule is analytic. checkResolution
// (round.ts:368-377) only fires when every holder has released, so the last
// holder burns to their own target and pays it in full: a round is fully
// determined by each bidder's chosen reservation.

import type { ItemInstance, Player, Round } from 'shared';
import { computeScores, getClassDefinition, getTemplate, pickAvailableClassId } from 'shared';
import type { ScoreBreakdown } from 'shared';
import { __botInternals, addBot } from '../../src/bots.js';
import { createRoomObject, ownsItemTemplate } from '../../src/rooms.js';
import type { Room } from '../../src/rooms.js';
import { buildLotPool, computeTimeRefund, tryOpenChests } from '../../src/round.js';
import { __setPolicyForTesting } from '../../src/botPolicy/index.js';
import { withSeed } from './rng.js';

// reservationMs consults getPolicy(), so a BOT_POLICY=ml left in the shell
// would quietly fold the learned net into every seat — including the ones the
// ablation calls "heuristic". Pin it off here: offline harnesses supply the net
// explicitly per seat via nnPolicy, never through ambient environment.
__setPolicyForTesting(null);

const {
  reservationMs,
  heuristicWillingMs,
  applyReserveCaps,
  marginalItemScore,
  expectedLotValue,
  recordLotObservation,
  personalityFor,
  sustainablePerLot,
  constants,
} = __botInternals;

// Mirrors of round.ts's module-private economy constants. Kept as a named
// object so the parity check in eval.ts can assert they still match.
export const ECONOMY = {
  SOLE_BIDDER_PRICE_MS: 5_000,
  INVESTOR_INTEREST_RATE: 0.03,
  AUCTIONEER_REBATE_RATE: 0.1,
  INSURER_REFUND_RATE: 0.25,
  HOURGLASS_REFUND_RATE: 0.5,
  GAMBLER_STREAK_REBATE_RATE_PER_WIN: 0.05,
  GAMBLER_MAX_STREAK_WINS: 4,
} as const;

export const SEATS = 4; // 3 bots (MAX_BOTS) plus one more — a one-human lobby

// What a seat decides when a lot comes up. `reservationMs` is pre-flinch and
// pre-cap; the simulator applies applyReserveCaps itself so no policy can
// bypass the two hard safety bounds.
export interface SeatDecision {
  enter: boolean;
  reservationMs: number;
}

export interface SeatPolicy {
  readonly name: string;
  decide(room: Room, player: Player, ctx: DecisionContext): SeatDecision;
}

export interface DecisionContext {
  roundIndex: number;
  // The heuristic's own pre-cap figure, so a learned policy can act as a
  // residual on it rather than relearning valuation from scratch.
  heuristicWilling: number;
  marginal: number;
  expected: number;
  perLot: number;
  // This round's frozen nerve roll — 1 at the entry decision, sampled once at
  // the commitment. Passed through so a policy that rebuilds the reservation
  // from its own parameters still gets the same noise draw the heuristic saw,
  // which is what makes the two comparable on a shared seed.
  nerveMultiplier: number;
}

export interface EpisodeResult {
  seed: number;
  scores: ScoreBreakdown[]; // one per seat, in seat order
  seatIds: string[];
  roundsPlayed: number;
  contestedRounds: number;
  passedRounds: number;
  itemsWon: number[];
  pricePaidMs: number[]; // total time each seat paid for lots it won
  committedMs: number[]; // total time each seat burned bidding, won or lost
  holds: number[]; // every individual hold, for distribution comparison
  entries: number[];
  finalTimeMs: number[];
  outOfTime: number;
}

// --- the heuristic seat -------------------------------------------------------

// Reproduces scheduleBotEntries (bots.ts:355-389) exactly, minus the setTimeout.
export const heuristicPolicy: SeatPolicy = {
  name: 'heuristic',
  decide(room, player, ctx) {
    const personality = personalityFor(room, player);
    const reserve = applyReserveCaps(player, ctx.heuristicWilling);

    const threshold = personality.entryThresholdRatio * ctx.expected;
    const confidence = Math.min(
      0.95,
      Math.max(0.1, 0.5 + (ctx.marginal - threshold) / (2 * Math.max(1, ctx.expected)))
    );

    // The sole-bidder gate is a rule fact, not a knob: an uncontested win costs
    // a flat SOLE_BIDDER_PRICE_MS regardless, so entering below it is a
    // guaranteed loss. Applies to every policy, learned or not.
    if (reserve < ECONOMY.SOLE_BIDDER_PRICE_MS || Math.random() > confidence) {
      return { enter: false, reservationMs: 0 };
    }
    return { enter: true, reservationMs: reserve };
  },
};

// --- noise: nerve, second winds, flinch --------------------------------------

function gaussian(): number {
  const u = Math.max(Number.EPSILON, Math.random());
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * Math.random());
}

// scheduleBotReleases samples nerve once per bot per round and holds to it,
// then rolls a second wind each time it reaches the target.
function sampleHoldMultiplier(): number {
  let multiplier = Math.exp(gaussian() * constants.NERVE_SIGMA);
  for (let i = 0; i < constants.MAX_SECOND_WINDS; i += 1) {
    if (Math.random() >= constants.SECOND_WIND_CHANCE) break;
    multiplier *= constants.SECOND_WIND_MULTIPLIER;
  }
  return multiplier;
}

// The live loop runs a per-tick hazard while rivals are still holding and the
// bot is past FLINCH_MIN_PROGRESS of its target. Integrated over the hold, that
// is one Bernoulli per round.
function applyFlinch(target: number): number {
  const exposedMs = target * (1 - constants.FLINCH_MIN_PROGRESS);
  const p = 1 - Math.exp((-constants.FLINCH_RATE_PER_SEC * exposedMs) / 1000);
  if (Math.random() >= p) return target;
  return target * (constants.FLINCH_MIN_PROGRESS + Math.random() * (1 - constants.FLINCH_MIN_PROGRESS));
}

// --- round resolution ---------------------------------------------------------

// Mirrors resolveRound (round.ts:379-551) in the same order. Any change there
// has to be reflected here; eval.ts's calibration check is what catches drift.
function resolveAbstractRound(
  room: Room,
  item: ItemInstance,
  holds: Map<string, number>,
  result: EpisodeResult,
  seatIndexById: Map<string, number>
) {
  const entrants = [...holds.entries()];

  // No bids: the lot passes. No charges, and no streak changes — round.ts:440
  // only touches streaks when there is a winner.
  if (entrants.length === 0) {
    result.passedRounds += 1;
    applyInvestorInterest(room);
    return;
  }

  let winnerId: string;
  let rawPrice: number;
  let runnerUpPrice = 0;

  if (entrants.length === 1) {
    // closeBidWindow short-circuits an uncontested lot before spending starts
    // (round.ts:266-269), so nothing is burned and the flat price applies.
    winnerId = entrants[0][0];
    rawPrice = 0;
  } else {
    result.contestedRounds += 1;
    const sorted = [...entrants].sort((a, b) => b[1] - a[1]);
    winnerId = sorted[0][0];
    rawPrice = sorted[0][1];
    runnerUpPrice = sorted[1][1];

    // Losers pay their full hold — this is an all-pay auction.
    for (const [playerId, held] of sorted.slice(1)) {
      const player = room.players.get(playerId)!;
      const seat = seatIndexById.get(playerId)!;
      player.timeRemainingMs = Math.max(0, player.timeRemainingMs - held);
      result.committedMs[seat] += held;
      result.holds.push(held);
      if (player.timeRemainingMs <= 0) {
        player.timeRemainingMs = 0;
        player.status = 'out_of_time';
      }
    }
  }

  const winner = room.players.get(winnerId)!;
  const winnerSeat = seatIndexById.get(winnerId)!;
  const requested = entrants.length === 1
    ? ECONOMY.SOLE_BIDDER_PRICE_MS
    : item.fairTrade
      ? runnerUpPrice
      : rawPrice;
  const paidPrice = Math.min(requested, winner.timeRemainingMs);

  winner.timeRemainingMs = Math.max(0, winner.timeRemainingMs - paidPrice);
  winner.status = winner.timeRemainingMs > 0 ? 'active' : 'out_of_time';
  result.committedMs[winnerSeat] += paidPrice;
  result.holds.push(paidPrice);
  result.pricePaidMs[winnerSeat] += paidPrice;
  result.itemsWon[winnerSeat] += 1;

  room.itemPricePaidMs.set(item.id, paidPrice);
  winner.stash.push(item.id);
  room.wonItems.set(item.id, item);

  const template = getTemplate(item.templateId);
  if (template?.effectType === 'timeRefund' && template.timeRefund) {
    const refund = computeTimeRefund(
      template.timeRefund,
      winner.timeRemainingMs,
      room.settings.startingTimeMs
    );
    if (refund > 0) {
      winner.timeRemainingMs += refund;
      if (winner.status === 'out_of_time') winner.status = 'active';
    }
  }

  if (winner.classId === 'auctioneer' && paidPrice > 0) {
    winner.timeRemainingMs += Math.round(paidPrice * ECONOMY.AUCTIONEER_REBATE_RATE);
    if (winner.status === 'out_of_time') winner.status = 'active';
  }

  // Streaks update before the gambler rebate — round.ts:445-449 runs first, so
  // the rebate already includes this win.
  for (const [playerId] of entrants) {
    const player = room.players.get(playerId)!;
    player.winStreak = playerId === winnerId ? player.winStreak + 1 : 0;
  }

  if (winner.classId === 'gambler' && paidPrice > 0) {
    const streakLevel = Math.min(winner.winStreak, ECONOMY.GAMBLER_MAX_STREAK_WINS);
    const rebate = Math.round(paidPrice * ECONOMY.GAMBLER_STREAK_REBATE_RATE_PER_WIN * streakLevel);
    if (rebate > 0) {
      winner.timeRemainingMs += rebate;
      if (winner.status === 'out_of_time') winner.status = 'active';
    }
  }

  tryOpenChests(room, winner);

  // Loser refunds. The Hourglass and the Insurer do not stack.
  for (const [playerId, held] of entrants) {
    if (playerId === winnerId || held <= 0) continue;
    const loser = room.players.get(playerId)!;
    if (ownsItemTemplate(room, playerId, 'chronomancers-hourglass')) {
      loser.timeRemainingMs += Math.round(held * ECONOMY.HOURGLASS_REFUND_RATE);
    } else if (loser.classId === 'insurer') {
      loser.timeRemainingMs += Math.round(held * ECONOMY.INSURER_REFUND_RATE);
    } else {
      continue;
    }
    if (loser.status === 'out_of_time' && loser.timeRemainingMs > 0) loser.status = 'active';
  }

  applyInvestorInterest(room);
}

function applyInvestorInterest(room: Room) {
  for (const player of room.players.values()) {
    if (player.classId !== 'investor' || player.status !== 'active' || player.timeRemainingMs <= 0) continue;
    player.timeRemainingMs += Math.round(player.timeRemainingMs * ECONOMY.INVESTOR_INTEREST_RATE);
  }
}

// --- the episode --------------------------------------------------------------

function seatRoom(room: Room, seatCount: number): Player[] {
  // addBot is capped at MAX_BOTS = 3; seat the rest directly. Personalities are
  // drawn without replacement per room, so all seats get distinct ones. Classes
  // must be distinct too — two investors in a four-seat lobby is a different
  // economy, so the manual seats go through pickAvailableClassId like addBot.
  for (let i = 0; i < seatCount; i += 1) {
    if (addBot(room)) continue;
    const classId = pickAvailableClassId([...room.players.values()].map((player) => player.classId));
    if (!classId) break;
    room.botCounter += 1;
    const id = `bot-${room.botCounter}`;
    room.players.set(id, {
      id,
      name: `seat-${i}`,
      timeRemainingMs: room.settings.startingTimeMs,
      status: 'active',
      stash: [],
      connected: true,
      portraitIndex: getClassDefinition(classId)!.portraitIndex,
      classId,
      winStreak: 0,
      isObserver: false,
      isBot: true,
    });
  }
  return [...room.players.values()];
}

// Builds the synthetic ActiveRound the bot's own functions read. revealedFields
// is the real reveal schedule (round.ts:883-904): material is public at round
// start, rarity lands at +7s which is exactly when spending begins, and
// specialModifier at +14s is deliberately withheld — that mid-hold reveal is a
// documented Phase-1 fidelity gap.
function setActiveRound(room: Room, item: ItemInstance, eligible: Player[], revealed: string[]) {
  const bidders: Round['bidders'] = {};
  for (const player of eligible) {
    bidders[player.id] = { isHolding: false, committedMs: 0, droppedAt: null };
  }
  room.activeRound = {
    round: {
      id: `round-${room.currentRoundIndex}`,
      itemInstanceId: item.id,
      status: 'active',
      initialBidDeadlineAt: null,
      bidWindowOpen: false,
      spendingStartedAt: null,
      bidders,
      revealedFields: revealed,
      winnerId: null,
      soleBidder: false,
      stalematePlayerIds: [],
      restrictedBidderIds: null,
    },
    item,
    holdStartedAt: new Map(),
    hasAnyoneHeld: false,
    bidWindowOpen: false,
    noBidTimer: null,
    maxDurationTimer: null,
    interRoundTimer: null,
    modifierRevealTimers: [],
    allowedBidderIds: null,
  };
}

export function runEpisode(seed: number, policies: SeatPolicy[]): EpisodeResult {
  return withSeed(seed, () => {
    const room = createRoomObject(`SIM${seed}`);
    const seats = seatRoom(room, policies.length);
    const seatIndexById = new Map(seats.map((player, index) => [player.id, index]));
    room.status = 'in_round';
    buildLotPool(room);

    const result: EpisodeResult = {
      seed,
      scores: [],
      seatIds: seats.map((player) => player.id),
      roundsPlayed: 0,
      contestedRounds: 0,
      passedRounds: 0,
      itemsWon: new Array(seats.length).fill(0),
      pricePaidMs: new Array(seats.length).fill(0),
      committedMs: new Array(seats.length).fill(0),
      holds: [],
      entries: new Array(seats.length).fill(0),
      finalTimeMs: new Array(seats.length).fill(0),
      outOfTime: 0,
    };

    for (let roundIndex = 0; roundIndex < room.roundsToPlay; roundIndex += 1) {
      const eligible = seats.filter(
        (player) => player.status === 'active' && player.timeRemainingMs > 0
      );
      if (eligible.length === 0) break;

      const item = room.lotPool.find((candidate) => candidate.id === room.auctionOrder[roundIndex]);
      if (!item) break;

      room.currentRoundIndex = roundIndex;
      result.roundsPlayed += 1;

      // --- entry decision: only `material` is public during the bid window ---
      setActiveRound(room, item, eligible, ['material']);
      const entered: Player[] = [];
      for (const player of eligible) {
        // Two-pass price resolution, exactly as scheduleBotEntries does: a
        // neutral guess, then the reservation that guess produces.
        const neutral = sustainablePerLot(room, player);
        const firstPass = reservationMs(room, player, neutral);
        const h = heuristicWillingMs(room, player, firstPass);
        const marginal = marginalItemScore(room, player, firstPass);
        const expected = expectedLotValue(room, player);

        // Every seat appraises every lot, bid or not — a declined lot is
        // evidence about this game's pool.
        recordLotObservation(room, player, marginal);

        const seat = seatIndexById.get(player.id)!;
        const decision = policies[seat].decide(room, player, {
          roundIndex,
          heuristicWilling: h.willing,
          marginal,
          expected,
          perLot: h.perLot,
          nerveMultiplier: 1,
        });
        if (decision.enter && decision.reservationMs > 0) {
          entered.push(player);
          room.activeRound!.round.bidders[player.id].isHolding = true;
          result.entries[seat] += 1;
        }
      }

      // --- commitment: rarity lands as spending starts, so re-read there ---
      const holds = new Map<string, number>();
      if (entered.length > 1) {
        room.activeRound!.round.revealedFields = ['material', 'rarity'];
        for (const player of entered) {
          const seat = seatIndexById.get(player.id)!;
          const neutral = sustainablePerLot(room, player);
          const firstPass = reservationMs(room, player, neutral);
          const nerveMultiplier = sampleHoldMultiplier();
          const h = heuristicWillingMs(room, player, firstPass, nerveMultiplier);
          const decision = policies[seat].decide(room, player, {
            roundIndex,
            heuristicWilling: h.willing,
            marginal: marginalItemScore(room, player, firstPass),
            expected: expectedLotValue(room, player),
            perLot: h.perLot,
            nerveMultiplier,
          });
          holds.set(player.id, applyFlinch(applyReserveCaps(player, decision.reservationMs)));
        }
      } else {
        for (const player of entered) holds.set(player.id, ECONOMY.SOLE_BIDDER_PRICE_MS);
      }

      resolveAbstractRound(room, item, holds, result, seatIndexById);
      room.activeRound = null;
    }

    result.scores = computeScores(seats, room.wonItems, room.itemPricePaidMs);
    result.finalTimeMs = seats.map((player) => player.timeRemainingMs);
    result.outOfTime = seats.filter((player) => player.status === 'out_of_time').length;
    return result;
  });
}
