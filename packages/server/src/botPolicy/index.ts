// Runtime entry point for the learned bidding policy.
//
// Off by default. Set BOT_POLICY=ml to enable; anything else, or a weights
// artifact that does not match the current feature encoder, falls back to the
// hand-tuned heuristic. That fallback is the rollback lever — flipping the env
// var needs no deploy of new code.

import { featureNamesHash, OBS_DIM } from './features.js';
import { MlpPolicy } from './policy.js';
import type { PolicyWeights } from './policy.js';
// Static import, not a dynamic one: weights.generated.ts is a committed
// artifact, and a plain ESM import keeps getPolicy() synchronous. The bot code
// paths that need it (addBot, startRound, scheduleBotReleases) are all
// synchronous, so a promise here would mean threading async through the room
// lifecycle. The module is ~90KB of number literals; parsing it when
// BOT_POLICY is unset costs nothing worth measuring.
import * as generated from './weights.generated.js';

let resolved = false;
let policy: MlpPolicy | null = null;

function load(): MlpPolicy | null {
  if (process.env.BOT_POLICY !== 'ml') return null;

  // A feature-layout change since training makes the weights meaningless. Fail
  // loudly to the heuristic rather than running a garbage policy.
  if (generated.POLICY_META.featureNamesHash !== featureNamesHash()) {
    console.warn(
      `[botPolicy] feature hash mismatch (weights ${generated.POLICY_META.featureNamesHash}, ` +
      `encoder ${featureNamesHash()}) — retrain required. Using the heuristic.`
    );
    return null;
  }
  if (generated.POLICY_META.obsDim !== OBS_DIM) {
    console.warn('[botPolicy] observation dimension mismatch — using the heuristic.');
    return null;
  }

  const weights: PolicyWeights = {
    obsDim: generated.POLICY_META.obsDim,
    layers: [...generated.POLICY_META.layers],
    obsMean: generated.OBS_MEAN,
    obsStd: generated.OBS_STD,
    w: generated.W,
    b: generated.B,
  };

  const model = new MlpPolicy(weights);

  // Parity check against the reference outputs the trainer embedded. Catches a
  // botched weight transpose, which would otherwise be a silently worse bot.
  for (const probe of generated.PROBES) {
    const out = model.forward(Float32Array.from(probe.obs));
    if (Math.abs(out.logMult - probe.logMult) > 1e-3 || Math.abs(out.entryLogit - probe.entryLogit) > 1e-3) {
      console.warn('[botPolicy] forward-pass parity check failed — using the heuristic.');
      return null;
    }
  }

  console.log(
    `[botPolicy] loaded ${generated.POLICY_META.parameters} parameters ` +
    `(anchor margin ${generated.POLICY_META.anchorMargin})`
  );
  return model;
}

export function getPolicy(): MlpPolicy | null {
  if (!resolved) {
    policy = load();
    resolved = true;
  }
  return policy;
}

// Test seam: lets the offline harnesses swap a policy in without an env var.
export function __setPolicyForTesting(model: MlpPolicy | null) {
  policy = model;
  resolved = true;
}
