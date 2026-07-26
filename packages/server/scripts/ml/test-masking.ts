// Masking and parity tests.
//
//   npx tsx scripts/ml/test-masking.ts
//
// The failure this exists to catch: the observation encoder reaching past
// botVisibleItem to the true item. Nothing would crash, the loss curve would
// look fine, and the shipped bot would be clairvoyant. The check is that
// mutating a hidden field on the real item changes nothing a non-prospector
// sees — and, so the test is not vacuous, that it does change what a prospector
// sees.

import type { ItemInstance, Player, Round } from 'shared';
import { rollItemInstanceForTemplate } from 'shared';
import { __botInternals, addBot } from '../../src/bots.js';
import { buildObservation, featureNamesHash, FEATURE_NAMES, OBS_DIM } from '../../src/botPolicy/features.js';
import { MlpPolicy } from '../../src/botPolicy/policy.js';
import { createRoomObject } from '../../src/rooms.js';
import type { Room } from '../../src/rooms.js';

const { botVisibleItem, heuristicWillingMs } = __botInternals;

function buildRoom(classId: string): { room: Room; bot: Player; item: ItemInstance } {
  const room = createRoomObject('MASK');
  addBot(room);
  const bot = [...room.players.values()][0];
  bot.classId = classId;
  room.roundsToPlay = 15;
  room.currentRoundIndex = 3;
  room.selectedMainTraits = ['armor', 'trinket', 'text'];
  room.status = 'in_round';

  const item = rollItemInstanceForTemplate('diamond-ring', 15);
  item.rarity = 'Common';
  item.material = 'Used';
  item.specialModifier = undefined;
  item.hiddenTraitId = undefined;

  const bidders: Round['bidders'] = {
    [bot.id]: { isHolding: true, committedMs: 0, droppedAt: null },
  };
  room.lotPool = [item];
  room.activeRound = {
    round: {
      id: 'round-1', itemInstanceId: item.id, status: 'active', initialBidDeadlineAt: null,
      bidWindowOpen: false, spendingStartedAt: null, bidders, revealedFields: [],
      winnerId: null, soleBidder: false, stalematePlayerIds: [], restrictedBidderIds: null,
    },
    item,
    holdStartedAt: new Map(), hasAnyoneHeld: true, bidWindowOpen: false,
    noBidTimer: null, maxDurationTimer: null, interRoundTimer: null,
    modifierRevealTimers: [], allowedBidderIds: null,
  };
  return { room, bot, item };
}

// Exactly the path reservationMs takes, so the test covers the shipped code.
function observe(room: Room, bot: Player): Float32Array {
  const visibleItem = botVisibleItem(room, bot)!;
  const heuristic = heuristicWillingMs(room, bot, 4_000);
  return buildObservation({
    room, player: bot, visibleItem,
    revealed: new Set(room.activeRound!.round.revealedFields),
    assumedPriceMs: 4_000,
    heuristicWillingMs: heuristic.willing,
    marginalScore: heuristic.marginal,
    expectedLot: heuristic.expected,
    perLotMs: heuristic.perLot,
    lotObservationCount: room.currentRoundIndex + 1,
  }, new Float32Array(OBS_DIM));
}

function differingFeatures(a: Float32Array, b: Float32Array): string[] {
  const out: string[] = [];
  for (let i = 0; i < a.length; i += 1) {
    if (Math.abs(a[i] - b[i]) > 1e-9) out.push(`${FEATURE_NAMES[i]} (${a[i]} -> ${b[i]})`);
  }
  return out;
}

const failures: string[] = [];

// --- 1. a non-prospector must be blind to every masked field -----------------
{
  const { room, bot, item } = buildRoom('hoarder');
  const before = observe(room, bot).slice();

  item.rarity = 'Legendary';
  item.material = 'Mint';
  item.specialModifier = 'Blessed';
  item.hiddenTraitId = 'windfall';

  const after = observe(room, bot);
  const differences = differingFeatures(before, after);
  if (differences.length > 0) {
    failures.push(`non-prospector saw hidden fields change:\n      ${differences.join('\n      ')}`);
  } else {
    console.log('  ok  non-prospector is blind to rarity/material/modifier/hiddenTrait');
  }
}

// --- 2. the same mutation must be visible once revealed ----------------------
// Without this, test 1 would also pass if the encoder simply ignored the fields.
{
  const { room, bot, item } = buildRoom('hoarder');
  room.activeRound!.round.revealedFields = ['material', 'rarity', 'specialModifier'];
  const before = observe(room, bot).slice();

  item.rarity = 'Legendary';
  item.material = 'Mint';
  item.specialModifier = 'Blessed';

  const differences = differingFeatures(before, observe(room, bot));
  if (differences.length === 0) {
    failures.push('revealed fields produced no observation change — the encoder ignores them');
  } else {
    console.log(`  ok  revealed fields do move the observation (${differences.length} features)`);
  }
}

// --- 3. class-granted sight ---------------------------------------------------
{
  const { room, bot, item } = buildRoom('prospector');
  const before = observe(room, bot).slice();
  item.rarity = 'Legendary';
  if (differingFeatures(before, observe(room, bot)).length === 0) {
    failures.push('prospector did not see an unrevealed rarity change');
  } else {
    console.log('  ok  prospector sees modifiers without a reveal');
  }
}
{
  const { room, bot, item } = buildRoom('appraiser');
  const before = observe(room, bot).slice();
  item.hiddenTraitId = 'windfall';
  if (differingFeatures(before, observe(room, bot)).length === 0) {
    failures.push('appraiser did not see the hidden trait');
  } else {
    console.log('  ok  appraiser sees the hidden trait');
  }
}

// --- 4. encoder self-consistency ---------------------------------------------
{
  if (FEATURE_NAMES.length !== OBS_DIM) {
    failures.push(`FEATURE_NAMES has ${FEATURE_NAMES.length} entries but OBS_DIM is ${OBS_DIM}`);
  } else {
    console.log(`  ok  ${OBS_DIM} features, hash ${featureNamesHash()}`);
  }
  const { room, bot } = buildRoom('hoarder');
  const observation = observe(room, bot);
  const bad = [...observation].findIndex((value) => !Number.isFinite(value));
  if (bad >= 0) failures.push(`non-finite feature ${FEATURE_NAMES[bad]}`);
  else console.log('  ok  all features finite');
}

// --- 5. runtime parity against the trainer's reference outputs ---------------
{
  try {
    const generated = await import('../../src/botPolicy/weights.generated.js');
    if (generated.POLICY_META.featureNamesHash !== featureNamesHash()) {
      console.log('  --  parity skipped: weights predate the current encoder');
    } else {
      const model = new MlpPolicy({
        obsDim: generated.POLICY_META.obsDim,
        layers: [...generated.POLICY_META.layers],
        obsMean: generated.OBS_MEAN,
        obsStd: generated.OBS_STD,
        w: generated.W,
        b: generated.B,
      });
      let worst = 0;
      for (const probe of generated.PROBES) {
        const out = model.forward(Float32Array.from(probe.obs));
        worst = Math.max(
          worst,
          Math.abs(out.logMult - probe.logMult),
          Math.abs(out.entryLogit - probe.entryLogit)
        );
      }
      if (worst > 1e-3) failures.push(`forward-pass parity off by ${worst.toExponential(2)}`);
      else console.log(`  ok  forward-pass parity within ${worst.toExponential(2)}`);
    }
  } catch {
    console.log('  --  parity skipped: no weights.generated.ts yet');
  }
}

console.log(
  failures.length === 0
    ? '\n  PASS'
    : `\n  FAIL\n${failures.map((f) => `    - ${f}`).join('\n')}`
);
process.exit(failures.length === 0 ? 0 : 1);
