// Seeded randomness for the training harness.
//
// The game's generators call Math.random() directly and deeply — item rolls
// (rollItemInstanceForTemplate), pickWeighted and shuffle in buildLotPool,
// rollHiddenTrait, the chest grant pool, personality assignment. Threading an
// RNG parameter through `shared/` would pollute production code for a
// training-only need, so instead we swap globalThis.Math.random for the scope
// of a call and put it back in a finally.
//
// This is why the trainer must stay single-threaded per worker: the override is
// process-global. Each worker_thread has its own isolate, so sharding is fine.

export type Rng = () => number;

// mulberry32: 32-bit state, passes gjrand, and one multiply-xorshift per call.
// Plenty for Monte Carlo over auction outcomes; not for anything cryptographic.
export function mulberry32(seed: number): Rng {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Runs fn with Math.random replaced by a seeded stream. Nested calls are safe —
// the previous implementation is restored, not the original.
export function withSeed<T>(seed: number, fn: (rng: Rng) => T): T {
  const previous = Math.random;
  const rng = mulberry32(seed);
  Math.random = rng;
  try {
    return fn(rng);
  } finally {
    Math.random = previous;
  }
}
