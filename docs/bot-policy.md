# Learned bot bidding policy

The bots' hold-time decision can be driven by a small dense neural network
trained offline with TensorFlow.js. It is **off by default**; set `BOT_POLICY=ml`
to enable it.

```
BOT_POLICY=ml npm run start --workspace=server
```

Unset the variable to fall back to the hand-tuned heuristic. That is the rollback
lever — it needs no code deploy.

## What the net actually does

It is a **residual on the existing heuristic**, not a replacement.
`reservationMs` (`packages/server/src/bots.ts`) still computes
`heuristicWillingMs` exactly as before; the net multiplies that figure by
`exp(tanh(logMult))`, which is confined to `[0.368, 2.718]`, and
`applyReserveCaps` still clamps the result.

Three properties follow, and they are the reason for this shape:

- **Zero weights reproduce today's bot exactly.** Behavior cloning is free and
  there is a hard floor under any regression. The output layer is
  zero-initialized, so training starts from the shipped behavior.
- **`marginalItemScore` is preserved.** It runs `computeScores` on the
  hypothetical stash and is already near-optimal; only the pricing/timing half
  is learned.
- **No policy output can make a bot bid itself out.** The `tanh` bound is a
  safety property, and `SELF_ELIMINATION_GUARD_MS` is applied after the
  multiplier.

Nerve, flinch and second winds are untouched. They live in
`scheduleBotReleases` and act on the *result* of `reservationMs`, so the
human-feeling jitter around the target is unchanged.

Two things the net deliberately does not control: weapon usage
(`scheduleBotWeaponUses` stays fully heuristic) and the
`reserve >= SOLE_BIDDER_PRICE_MS` entry floor, which is a rule fact rather than
a knob — an uncontested win costs a flat 5000ms regardless, so entering below
that is a guaranteed loss.

## Results

1200 held-out seeds x 4 seat rotations, one contender against three frozen
heuristic bots. Seeds are disjoint from every training range.

| contender | margin (95% CI) | win rate | mean score | items | price/item |
|---|---|---|---|---|---|
| heuristic (incumbent) | 0.00 [-1.51, 1.63] | 25.0% | 85.6 | 2.92 | 9.11s |
| CEM scalars | +32.30 [30.79, 33.79] | 46.8% | 118.7 | 4.12 | 9.05s |
| **policy net** | **+49.38 [48.09, 50.77]** | **60.8%** | **136.3** | 4.54 | 9.28s |

The net beats the scalar baseline by 16.5 standard errors. The acceptance rule
("if the net does not clear CEM by more than one bootstrap SE, ship CEM and
delete the net") was written into `scripts/ml/ablation.ts` before training.

Two results worth recording because they contradict what was expected going in:

- **The scalar CEM overfit its training seeds.** It measured +52.8 margin during
  the search and +32.3 on held-out seeds. The net measured +47.0 and +49.4 —
  it generalized, the scalar search did not.
- **The heuristic was under-bidding, not over-bidding.** The expectation was
  that a learned policy would shade *down* in an all-pay auction and lower its
  price per item. Both the CEM and the net went the other way: they bid harder,
  win far more lots, and pay roughly the same per item.

## Retraining

```
npm run ml:gate       --workspace=server   # symmetry gate: must pass before anything else
npm run ml:test       --workspace=server   # masking + forward-pass parity
npm run ml:train:cem  --workspace=server   # the scalar control
npm run ml:train:nn   --workspace=server   # the net -> src/botPolicy/weights.generated.ts
npm run ml:ablation   --workspace=server   # the decision
```

`weights.generated.ts` is a checked-in TypeScript module, not a TF.js
`model.json` + shards, because the runtime forward pass is hand-rolled and the
server must never import TensorFlow (see below). It embeds a
`featureNamesHash`; if the feature encoder changes without a retrain, the policy
refuses to load and logs a warning rather than running on meaningless weights.
`PROBES` holds three reference outputs from the trainer so the hand-rolled
forward pass is verified rather than assumed.

### Why TensorFlow never reaches production

`Dockerfile` runs `npm ci` with no `--omit=dev`, and the start script goes
through `tsx`, which is itself a devDependency — so devDependencies *are*
installed in the deployed image and cannot simply be dropped. `@tensorflow/tfjs`
is 272MB; the three sub-packages actually needed
(`tfjs-core` + `tfjs-layers` + `tfjs-backend-cpu`) are 81MB. That is still 81MB
of image for a script that runs on a laptop.

**Follow-up worth doing:** move `scripts/ml/` into its own workspace package so
the server image stops carrying the trainer, or add a `.dockerignore` entry.

Beyond size, `tf.loadLayersModel` is async while `addBot` / `startRound` /
`scheduleBotReleases` are synchronous, and a missed `tf.dispose` in a
long-lived multi-room server is a slow leak. The runtime forward pass is ~25
lines of typed-array arithmetic in `src/botPolicy/policy.ts` and has neither
problem.

## The simulator, and what it is not

`scripts/ml/sim.ts` replaces the timer-driven state machine and **only** the
state machine. It uses the real `createRoomObject`, `buildLotPool`,
`rollItemInstanceForTemplate`, `computeScores`, `tryOpenChests` and
`computeTimeRefund`, and the bot's own `reservationMs` / `marginalItemScore`.
This is sound because `checkResolution` only fires once every holder has
released, so the last holder burns to their own target and pays it in full — a
round is fully determined by each bidder's chosen reservation.

It runs ~800 episodes/sec against ~75 real seconds per game for
`bot-game-sim.ts`.

### Accepted fidelity gaps

| Gap | Status |
|---|---|
| Chests, `timeRefund`, auctioneer/gambler rebates, hourglass/insurer refunds, investor interest | **Modelled** |
| Nerve (log-normal), second winds, flinch | **Modelled** — flinch as one Bernoulli per round rather than a per-tick hazard |
| Weapon active effects (`destroyLot`, `forceWithdraw`, `stealTime`, …) | **Omitted** — ~2 lots/game carry weapons |
| Mid-hold reveal of `specialModifier` at spend+7s | **Omitted** — entry sees `material`, the commitment sees `material` + `rarity` |
| Stalemates | **Omitted** — structurally impossible bot-only (18s cap < 60s buzzer), and asserted |
| Arcane Staff transform, Dual Daggers, `forceEnter` | **Omitted** |
| **Human opponents** | **Not modelled at all** |

Calibration against the real loop (`npm run ml:calibrate --workspace=server`,
fed by `npx tsx scripts/bot-game-sim.ts N`):

| metric | real | abstract |
|---|---|---|
| contested rate | 0.425 | 0.450 |
| passed rate | 0.275 | 0.248 |
| mean hold | 7.64s | 7.11s |
| mean time left | 13.9s | 14.6s |
| mean score | 105.8 | 113.9 |

Worst KS D = 0.156 over 8 real games, which is at the small-sample critical
value — this wants a longer run to tighten. The abstract simulator scores about
7% high, consistent with omitting the weapon effects that destroy lots and drain
clocks.

## The dominant caveat

**The bot is optimized against bots.** No human is modelled anywhere in the
training loop. A policy that beats the heuristic 60.8% of the time in self-play
may not be a better opponent for a person to play against — it may simply be
less fun. Only real play will tell, and the `BOT_POLICY` switch exists so that
can be tested cheaply.
