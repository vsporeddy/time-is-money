// The runtime forward pass. Deliberately plain JavaScript — no TensorFlow.
//
// Reasons this is hand-rolled rather than tf.loadLayersModel, in order of how
// much they would actually hurt:
//   1. Dockerfile:6 is `npm ci` with no --omit=dev, so anything in
//      package.json reaches the fly.io image. Keeping TF out of the runtime
//      import graph keeps the deployed server at express + socket.io.
//   2. tf.loadLayersModel is async, while addBot / startRound /
//      scheduleBotReleases are all synchronous. Threading a promise through the
//      room lifecycle would be a refactor done purely to satisfy a library.
//   3. Tensors need tidy/dispose. In a long-lived multi-room server a missed
//      dispose is a slow leak that only shows up in production. Typed arrays
//      have no such failure mode.
//   4. At ~10k MACs the per-op dispatch overhead exceeds the arithmetic.
//
// The trainer prints its own predictions on three held-out observations, and
// export-weights.ts embeds them, so the port is verified rather than assumed.

export interface PolicyWeights {
  obsDim: number;
  layers: number[]; // [in, h1, h2, ..., out]
  obsMean: readonly number[];
  obsStd: readonly number[];
  w: readonly (readonly number[])[]; // row-major, [in * out] per layer
  b: readonly (readonly number[])[];
}

export interface PolicyOutput {
  logMult: number; // residual on the heuristic, pre-tanh
  entryLogit: number;
}

export class MlpPolicy {
  private readonly weights: PolicyWeights;
  private readonly buffers: Float32Array[];
  private readonly whitened: Float32Array;

  constructor(weights: PolicyWeights) {
    this.weights = weights;
    // Pre-allocated so the hot path never allocates: reservationMs runs roughly
    // 120 times per round with three bots.
    this.whitened = new Float32Array(weights.obsDim);
    this.buffers = weights.layers.slice(1).map((size) => new Float32Array(size));
  }

  forward(obs: Float32Array): PolicyOutput {
    const { obsMean, obsStd, w, b, layers } = this.weights;

    for (let i = 0; i < this.whitened.length; i += 1) {
      const std = obsStd[i];
      this.whitened[i] = (obs[i] - obsMean[i]) / (std > 1e-6 ? std : 1);
    }

    let input: Float32Array = this.whitened;
    for (let layer = 0; layer < w.length; layer += 1) {
      const inSize = layers[layer];
      const outSize = layers[layer + 1];
      const weightRow = w[layer];
      const bias = b[layer];
      const output = this.buffers[layer];
      const isLast = layer === w.length - 1;

      for (let j = 0; j < outSize; j += 1) {
        let sum = bias[j];
        const base = j * inSize;
        for (let i = 0; i < inSize; i += 1) sum += weightRow[base + i] * input[i];
        // ReLU everywhere but the output heads, which stay linear.
        output[j] = isLast ? sum : sum > 0 ? sum : 0;
      }
      input = output;
    }

    return { logMult: input[0], entryLogit: input[1] };
  }
}

// The residual bound. exp(tanh(x)) lands in [0.368, 2.718], so a pathological
// policy can at most 2.7x or 0.37x the heuristic — and applyReserveCaps still
// clamps whatever comes out. This is a safety property, not a nicety.
export function residualMultiplier(logMult: number): number {
  return Math.exp(Math.tanh(logMult));
}

export function sigmoid(x: number): number {
  return 1 / (1 + Math.exp(-x));
}
