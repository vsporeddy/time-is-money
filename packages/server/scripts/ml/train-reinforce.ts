// Phase 3: REINFORCE over the residual policy net, in pure self-play.
//
//   npx tsx scripts/ml/train-reinforce.ts [updates]
//
// Why REINFORCE works here despite a sparse, episode-terminal reward: all four
// seats share the same lot pool within an episode, so the seat-mean is a
// near-perfect control variate. Item-roll variance — which dominates
// episode-to-episode noise far more than the policy does — cancels in
//
//     A_seat = (total_seat - mean(totals)) / std(totals)
//
// That is the same benefit common random numbers would buy, obtained inside the
// episode instead. It is also exactly what makes self-play the right choice for
// this game rather than a compromise.
//
// Rollouts run through the same plain-JS MlpPolicy that production uses; only
// the gradient step touches TensorFlow. That keeps the hot loop allocation-free
// and guarantees the thing being trained is the thing that ships.

import * as tf from '@tensorflow/tfjs-core';
import '@tensorflow/tfjs-backend-cpu';
import * as tfl from '@tensorflow/tfjs-layers';
import { writeFileSync } from 'node:fs';
import { evaluate } from './env.js';
import { heuristicPolicy, runEpisode, SEATS } from './sim.js';
import type { SeatPolicy } from './sim.js';
import { HIDDEN_LAYERS, LAYER_SIZES, nnPolicy, zeroWeights } from './nn.js';
import type { Recorder, Transition } from './nn.js';
import { buildObservation, featureNamesHash, OBS_DIM } from '../../src/botPolicy/features.js';
import { MlpPolicy } from '../../src/botPolicy/policy.js';
import type { PolicyWeights } from '../../src/botPolicy/policy.js';
import { makeObsContext } from './nn.js';
import type { DecisionContext } from './sim.js';

const UPDATES = Number(process.argv[2] ?? 300);
const EPISODES_PER_UPDATE = 96;
const LEARNING_RATE = 3e-4;
const ENTROPY_BONUS = 1e-3;
const INITIAL_LOG_STD = Math.log(0.35);
const ANCHOR_EVERY = 25;
const ANCHOR_SEEDS = 200;
const OUT_PATH = new URL('../../src/botPolicy/weights.generated.ts', import.meta.url).pathname;

await tf.setBackend('cpu');
await tf.ready();

// --- observation normalization ------------------------------------------------
// A frozen affine whiten computed from heuristic-driven play. Frozen because a
// moving normalizer would make the exported weights depend on statistics that
// no longer exist at inference time.

console.log('warmup: collecting observation statistics from heuristic play...');
const warmupObs: Float32Array[] = [];
{
  const collector: SeatPolicy = {
    name: 'collect',
    decide(room, player, ctx: DecisionContext) {
      const obsContext = makeObsContext(room, player, ctx);
      if (obsContext && warmupObs.length < 40_000) {
        warmupObs.push(buildObservation(obsContext, new Float32Array(OBS_DIM)));
      }
      return heuristicPolicy.decide(room, player, ctx);
    },
  };
  for (let seed = 0; seed < 700 && warmupObs.length < 40_000; seed += 1) {
    runEpisode(2_000_000 + seed, Array.from({ length: SEATS }, () => collector));
  }
}

const obsMean = new Array(OBS_DIM).fill(0);
const obsStd = new Array(OBS_DIM).fill(1);
for (let i = 0; i < OBS_DIM; i += 1) {
  let sum = 0;
  for (const obs of warmupObs) sum += obs[i];
  obsMean[i] = sum / warmupObs.length;
  let variance = 0;
  for (const obs of warmupObs) variance += (obs[i] - obsMean[i]) ** 2;
  // Constant features (an effect type no lot in the pool has, say) get std 1 so
  // whitening leaves them at zero rather than amplifying float noise.
  obsStd[i] = Math.max(Math.sqrt(variance / warmupObs.length), 1e-3);
}
console.log(`  ${warmupObs.length} observations, ${OBS_DIM} features\n`);

// --- model --------------------------------------------------------------------

const model = tfl.sequential();
model.add(tfl.layers.dense({
  inputShape: [OBS_DIM],
  units: HIDDEN_LAYERS[0],
  activation: 'relu',
  kernelInitializer: tfl.initializers.glorotUniform({}),
}));
for (const units of HIDDEN_LAYERS.slice(1)) {
  model.add(tfl.layers.dense({ units, activation: 'relu' }));
}
// Zero-initialized head: the policy starts as an exact copy of the heuristic,
// so training can only be measured as movement away from a known-good baseline.
model.add(tfl.layers.dense({
  units: 2,
  kernelInitializer: tfl.initializers.zeros(),
  biasInitializer: tfl.initializers.zeros(),
}));

const logStd = tf.variable(tf.scalar(INITIAL_LOG_STD), true, 'logStd');
const optimizer = tf.train.adam(LEARNING_RATE);
const trainable = [...model.trainableWeights.map((w) => w.read() as tf.Variable), logStd];
const parameterCount = model.countParams() + 1;
console.log(`model ${LAYER_SIZES.join(' -> ')}  (${parameterCount} parameters)\n`);

function currentWeights(): PolicyWeights {
  const dense = model.layers.map((layer) => layer.getWeights());
  return {
    obsDim: OBS_DIM,
    layers: LAYER_SIZES,
    obsMean,
    obsStd,
    // tfjs dense kernels are [in, out]; the runtime forward pass indexes
    // row-major by output unit, so transpose on the way out.
    w: dense.map(([kernel]) => {
      const [inSize, outSize] = kernel.shape as [number, number];
      const flat = kernel.dataSync();
      const transposed = new Array(inSize * outSize);
      for (let j = 0; j < outSize; j += 1) {
        for (let i = 0; i < inSize; i += 1) transposed[j * inSize + i] = flat[i * outSize + j];
      }
      return transposed;
    }),
    b: dense.map(([, bias]) => Array.from(bias.dataSync())),
  };
}

// --- training loop --------------------------------------------------------------

const anchorSeeds = Array.from({ length: ANCHOR_SEEDS }, (_, i) => 8_000_000 + i);
let bestAnchor = -Infinity;
let bestWeights = currentWeights();
const history: { update: number; anchorMargin: number; winRate: number }[] = [];

for (let update = 1; update <= UPDATES; update += 1) {
  const weights = currentWeights();
  const std = Math.exp(logStd.dataSync()[0]);

  // --- rollouts: every seat is a copy of the current policy ------------------
  const batch: { transition: Transition; advantage: number }[] = [];
  for (let e = 0; e < EPISODES_PER_UPDATE; e += 1) {
    const recorders: Recorder[] = Array.from({ length: SEATS }, () => ({ transitions: [] }));
    const policies = Array.from({ length: SEATS }, (_, seat) =>
      nnPolicy(weights, {
        seat,
        logStd: logStd.dataSync()[0],
        stochastic: true,
        recorder: recorders[seat],
      })
    );
    const seed = update * 7_919 + e;
    const result = runEpisode(seed, policies);

    const totals = result.scores.map((score) => score.total);
    const mean = totals.reduce((sum, value) => sum + value, 0) / totals.length;
    const variance = totals.reduce((sum, value) => sum + (value - mean) ** 2, 0) / totals.length;
    const spread = Math.sqrt(variance);
    // A flat episode carries no preference between seats; including it would
    // just inject noise scaled by 1/epsilon.
    if (spread < 1e-6) continue;

    for (let seat = 0; seat < SEATS; seat += 1) {
      const advantage = (totals[seat] - mean) / spread;
      for (const transition of recorders[seat].transitions) {
        batch.push({ transition, advantage });
      }
    }
  }

  if (batch.length === 0) {
    console.log(`update ${update}: empty batch, skipping`);
    continue;
  }

  // --- gradient step ---------------------------------------------------------
  const obsTensor = tf.tensor2d(
    batch.flatMap(({ transition }) => Array.from(transition.obs)),
    [batch.length, OBS_DIM]
  );
  const whitened = tf.tidy(() =>
    tf.div(tf.sub(obsTensor, tf.tensor1d(obsMean)), tf.tensor1d(obsStd))
  );
  const sampleTensor = tf.tensor1d(batch.map(({ transition }) => transition.logMultSample));
  const enteredTensor = tf.tensor1d(batch.map(({ transition }) => transition.entered));
  const advantageTensor = tf.tensor1d(batch.map(({ advantage }) => advantage));

  const lossValue = optimizer.minimize(() => {
    const output = model.apply(whitened) as tf.Tensor2D;
    const mean = tf.reshape(tf.slice(output, [0, 0], [batch.length, 1]), [batch.length]);
    const entryLogit = tf.reshape(tf.slice(output, [0, 1], [batch.length, 1]), [batch.length]);

    // Gaussian log-density of the action that was actually taken, dropping the
    // constant term (it has no gradient).
    const sd = tf.exp(logStd);
    const z = tf.div(tf.sub(sampleTensor, mean), sd);
    const logProbMult = tf.sub(tf.mul(tf.square(z), -0.5), logStd);

    // Bernoulli log-density for the entry decision: -BCE(entered, logit).
    const p = tf.sigmoid(entryLogit);
    const logProbEnter = tf.add(
      tf.mul(enteredTensor, tf.log(tf.add(p, 1e-8))),
      tf.mul(tf.sub(1, enteredTensor), tf.log(tf.add(tf.sub(1, p), 1e-8)))
    );

    const policyLoss = tf.neg(
      tf.mean(tf.mul(tf.add(logProbMult, logProbEnter), advantageTensor))
    );

    // Entropy: the Gaussian's is logStd up to a constant; the Bernoulli's keeps
    // the entry head from saturating to always-in or always-out early.
    const bernoulliEntropy = tf.neg(
      tf.mean(
        tf.add(
          tf.mul(p, tf.log(tf.add(p, 1e-8))),
          tf.mul(tf.sub(1, p), tf.log(tf.add(tf.sub(1, p), 1e-8)))
        )
      )
    );
    const entropy = tf.add(logStd, bernoulliEntropy);

    return tf.sub(policyLoss, tf.mul(entropy, ENTROPY_BONUS)) as tf.Scalar;
  }, true, trainable);

  const loss = lossValue ? lossValue.dataSync()[0] : NaN;
  lossValue?.dispose();
  tf.dispose([obsTensor, whitened, sampleTensor, enteredTensor, advantageTensor]);

  // --- anchor: collapse detector, never a training signal --------------------
  if (update % ANCHOR_EVERY === 0 || update === UPDATES) {
    const evaluated = currentWeights();
    const anchorPolicies: SeatPolicy[] = [
      nnPolicy(evaluated, { seat: 0, logStd: -Infinity, stochastic: false }, 'nn'),
      heuristicPolicy,
      heuristicPolicy,
      heuristicPolicy,
    ];
    const anchor = evaluate(anchorSeeds, anchorPolicies);
    const margin = anchor.seats[0].meanMargin;
    const winRate = anchor.seats[0].winRate;
    history.push({ update, anchorMargin: margin, winRate });

    if (margin > bestAnchor) {
      bestAnchor = margin;
      bestWeights = evaluated;
    }
    console.log(
      `update ${String(update).padStart(4)}` +
      `  loss ${loss.toFixed(4).padStart(9)}` +
      `  std ${std.toFixed(3)}` +
      `  batch ${String(batch.length).padStart(5)}` +
      `  anchorMargin ${margin.toFixed(2).padStart(7)}` +
      `  anchorWin ${(winRate * 100).toFixed(1).padStart(5)}%`
    );

    // Co-degradation guard: in pure self-play the population can shade toward
    // zero together while relative fitness still looks healthy. The anchor is
    // the only view that can see it.
    const recent = history.slice(-4);
    if (recent.length === 4 && recent.every((h, i) => i === 0 || h.anchorMargin < recent[i - 1].anchorMargin)) {
      console.log('  WARNING: anchor margin falling for 4 consecutive checks — possible co-degradation');
    }
  }
}

// --- export --------------------------------------------------------------------

const probeModel = new MlpPolicy(bestWeights);
const probes = warmupObs.slice(0, 3).map((obs) => {
  const out = probeModel.forward(obs);
  return {
    obs: Array.from(obs).map((v) => Number(v.toPrecision(6))),
    logMult: out.logMult,
    entryLogit: out.entryLogit,
  };
});

const round6 = (values: readonly number[]) => values.map((v) => Number(v.toPrecision(6)));
const source = `// GENERATED by scripts/ml/train-reinforce.ts — do not edit by hand.
//
// Plain weights, not a TF.js model.json + shards: the runtime forward pass in
// policy.ts is hand-rolled so the deployed server never imports TensorFlow.
// featureNamesHash guards against the encoder drifting after training — a
// mismatch is a load-time failure, not a silently garbage policy.

export const POLICY_META = {
  version: 1,
  obsDim: ${OBS_DIM},
  layers: ${JSON.stringify(LAYER_SIZES)},
  parameters: ${parameterCount},
  featureNamesHash: '${featureNamesHash()}',
  anchorMargin: ${bestAnchor.toFixed(3)},
  updates: ${UPDATES},
} as const;

export const OBS_MEAN: readonly number[] = ${JSON.stringify(round6(obsMean))};
export const OBS_STD: readonly number[] = ${JSON.stringify(round6(obsStd))};
export const W: readonly (readonly number[])[] = ${JSON.stringify(bestWeights.w.map(round6))};
export const B: readonly (readonly number[])[] = ${JSON.stringify(bestWeights.b.map(round6))};

// Reference outputs from the trainer, for the runtime parity check.
export const PROBES: readonly { obs: readonly number[]; logMult: number; entryLogit: number }[] =
  ${JSON.stringify(probes)};
`;

writeFileSync(OUT_PATH, source);
console.log(`\nbest anchor margin ${bestAnchor.toFixed(2)} points -> ${OUT_PATH}`);
