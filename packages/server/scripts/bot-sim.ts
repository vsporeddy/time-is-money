// Offline harness for the bot bidding utility metric. Samples the real
// reservationMs / marginalItemScore / nerve functions across synthetic lots and
// prints the resulting distributions — the tick loop itself is timer-driven and
// is verified by playing a QUICK AUCTION game.
//
//   npx tsx scripts/bot-sim.ts
//
import type { ItemInstance, Player, Round } from 'shared';
import { ITEM_TEMPLATES, rollItemInstanceForTemplate } from 'shared';
import { __botInternals, addBot } from '../src/bots.js';
import { createRoomObject } from '../src/rooms.js';
import type { Room } from '../src/rooms.js';

const { reservationMs, marginalItemScore, expectedLotValue, recordLotObservation, personalityFor, sustainablePerLot, sampleNerveMultiplier, constants } = __botInternals;

const LOTS = 2_000;
const ROUNDS_TO_PLAY = 15;
const STARTING_TIME_MS = 60_000;

function buildRoom(): Room {
  const room = createRoomObject('SIM');
  room.roundsToPlay = ROUNDS_TO_PLAY;
  room.selectedMainTraits = ['armor', 'trinket', 'text'];
  // addBot is lobby-gated and capped at MAX_BOTS = 3. Personalities are drawn
  // without replacement per room, so seating five bots covers all five exactly
  // once — a real game only ever sees three, but the sim wants full coverage.
  for (let i = 0; i < 3; i += 1) addBot(room);
  const seated = [...room.players.values()];
  for (let n = 4; n <= 5; n += 1) {
    const id = `bot-${n}`;
    room.players.set(id, { ...seated[0], id, name: `sim-${n}`, stash: [] });
  }
  for (const bot of room.players.values()) personalityFor(room, bot);
  room.status = 'in_round';
  return room;
}

function setLot(room: Room, item: ItemInstance, roundIndex: number, holdingCount: number) {
  const bots = [...room.players.values()];
  const bidders: Round['bidders'] = {};
  bots.forEach((bot, index) => {
    bidders[bot.id] = { isHolding: index < holdingCount, committedMs: 0, droppedAt: null };
  });

  room.currentRoundIndex = roundIndex;
  room.activeRound = {
    round: {
      id: `round-${roundIndex}`,
      itemInstanceId: item.id,
      status: 'active',
      initialBidDeadlineAt: null,
      bidWindowOpen: false,
      spendingStartedAt: null,
      bidders,
      revealedFields: ['material', 'rarity', 'specialModifier'],
      winnerId: null,
      soleBidder: false,
      stalematePlayerIds: [],
      restrictedBidderIds: null,
    },
    item,
    holdStartedAt: new Map(),
    hasAnyoneHeld: true,
    bidWindowOpen: false,
    noBidTimer: null,
    maxDurationTimer: null,
    interRoundTimer: null,
    modifierRevealTimers: [],
    allowedBidderIds: null,
  };
}

function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  return sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * p))];
}

// Lots the bot has no interest in (reservation 0) are "didn't want it", not
// "held briefly" — they'd swamp the spread, so report them separately.
function summarize(label: string, values: number[]) {
  const bidding = values.filter((value) => value > 0).sort((a, b) => a - b);
  const skipRate = 1 - bidding.length / Math.max(1, values.length);
  const mean = bidding.reduce((sum, value) => sum + value, 0) / Math.max(1, bidding.length);
  const p10 = percentile(bidding, 0.1);
  const p90 = percentile(bidding, 0.9);
  console.log(
    `  ${label.padEnd(14)} n=${String(bidding.length).padStart(5)}  skip=${(skipRate * 100).toFixed(0).padStart(3)}%` +
    `  mean=${mean.toFixed(0).padStart(6)}ms  p10=${p10.toFixed(0).padStart(6)}` +
    `  p50=${percentile(bidding, 0.5).toFixed(0).padStart(6)}  p90=${p90.toFixed(0).padStart(6)}` +
    `  p90/p10=${(p90 / Math.max(1, p10)).toFixed(2)}`
  );
}

// --- 1. Reservation distribution, by personality -----------------------------

function reservationSweep(holdingCount: number, timeRemainingMs: number, roundIndex: number) {
  const room = buildRoom();
  const byPersonality = new Map<string, number[]>();
  const msPerPoint: number[] = [];

  for (let lot = 0; lot < LOTS; lot += 1) {
    const template = ITEM_TEMPLATES[lot % ITEM_TEMPLATES.length];
    const item = rollItemInstanceForTemplate(template.id, ROUNDS_TO_PLAY);
    setLot(room, item, roundIndex + (lot % 3), holdingCount);

    for (const bot of room.players.values()) {
      bot.timeRemainingMs = timeRemainingMs;
      const neutral = sustainablePerLot(room, bot);
      // Same two-pass price resolution scheduleBotEntries does, then the nerve
      // roll — passed in, so the sampled targets respect the hard caps.
      const firstPass = reservationMs(room, bot, neutral);
      const noised = reservationMs(room, bot, firstPass, sampleNerveMultiplier());

      const name = personalityFor(room, bot).name;
      if (!byPersonality.has(name)) byPersonality.set(name, []);
      byPersonality.get(name)!.push(noised);

      recordLotObservation(room, bot, marginalItemScore(room, bot, neutral));
      msPerPoint.push(sustainablePerLot(room, bot) / Math.max(1, expectedLotValue(room, bot)));
    }
  }

  const meanRate = msPerPoint.reduce((sum, value) => sum + value, 0) / msPerPoint.length;
  console.log(
    `\n[rivals holding: ${holdingCount}] [clock: ${timeRemainingMs}ms] [round ${roundIndex}/${ROUNDS_TO_PLAY}]` +
    `  mean msPerPoint=${meanRate.toFixed(1)}`
  );
  for (const [name, values] of [...byPersonality].sort()) summarize(name, values);
}

console.log('=== noised reservation targets ===');
reservationSweep(2, STARTING_TIME_MS, 0);
reservationSweep(2, STARTING_TIME_MS, 12); // late game: fewer lots left, freer spending
reservationSweep(2, 8_000, 5); // short on clock: exchange rate must shrink
reservationSweep(1, STARTING_TIME_MS, 0); // uncontested
reservationSweep(3, STARTING_TIME_MS, 0); // crowded: escalators up, shaders down

// --- 2. Nerve multiplier distribution ---------------------------------------

const nerve = Array.from({ length: 20_000 }, () => sampleNerveMultiplier());
const sortedNerve = [...nerve].sort((a, b) => a - b);
console.log(
  `\n=== nerve multiplier (sigma ${constants.NERVE_SIGMA}) ===\n` +
  `  mean=${(nerve.reduce((s, v) => s + v, 0) / nerve.length).toFixed(3)}` +
  `  p10=${percentile(sortedNerve, 0.1).toFixed(3)}` +
  `  p50=${percentile(sortedNerve, 0.5).toFixed(3)}` +
  `  p90=${percentile(sortedNerve, 0.9).toFixed(3)}` +
  `  max=${sortedNerve[sortedNerve.length - 1].toFixed(3)}`
);

// --- 3. Price sensitivity (the Investment / Bargain blind spot) ---------------
// Only `investment` is live today — no template in items.ts sets
// scoreScaling: 'bargain' yet, so that branch is checked by construction.

console.log('\n=== marginal score vs assumed price paid ===');
{
  const room = buildRoom();
  const bot = [...room.players.values()][0] as Player;
  bot.timeRemainingMs = STARTING_TIME_MS;

  const plain = rollItemInstanceForTemplate('diamond-ring', ROUNDS_TO_PLAY);
  const investment: ItemInstance = { ...plain, id: 'sim-investment', investment: true };

  for (const [label, item] of [['plain', plain], ['investment', investment]] as const) {
    setLot(room, item, 0, 2);
    const row = [0, 2_000, 5_000, 10_000]
      .map((price) => `${price / 1000}s=${marginalItemScore(room, bot, price).toFixed(1)}`)
      .join('  ');
    console.log(`  ${label.padEnd(11)} ${row}`);
  }
}
