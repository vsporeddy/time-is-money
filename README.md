# Time is Money

A browser-based multiplayer party game built for a game jam (theme: **COUNT DOWN**). Time is both your clock and your currency — you spend it to bid on items, and whoever's stash is worth the most when everyone's run out of time wins.

## How it plays

- Everyone starts with a pool of time (default 60s).
- Each round, an item comes up for auction. Its true dollar value is hidden — you only see its material/rarity flavor and its traits until it sells.
- During each auction's 6-second opt-in window, click **Bid** to join without spending time, or **Cancel Bid** to change your mind and bid again later in the same window. When it closes, every opted-in player's time ticks down live. Click **Withdraw** to bail out — but time you've already spent is gone either way (sunk cost).
- The final active bidder to withdraw wins the lot and pays for however long they held. If nobody remains opted in when the opening window closes, the item goes unclaimed.
- Some items have special behavior, all visible as tags on the item card before you bid:
  - **Investment** — scores higher the longer you held to win it.
  - **Bargain** — scores higher the *cheaper* you win it (rewards sniping uncontested lots).
  - **Fair Trade** (second-price rebate) — you only pay the runner-up's price, not your full hold time.
  - **Time Refund** — winning it gives some time back (flat, or scaled up the lower your time is, as a catch-up mechanic).
  - **Loner** — bonus if it's the only copy of that item in your stash.
- Items also carry category traits (Weapon, Armor, Food, etc., some nested — a Sword counts for both "Sword" and "Weapon") that pay out a bonus once you own enough of a kind, TFT-trait style. A couple of hidden traits (Blessed/Cursed/Lucky) can roll on any item and are only revealed once it sells.
- Owning multiple exact copies of the same item has diminishing returns, so trait-hunting across different items beats hoarding one thing.
- Game ends once every player is out of time; final ranking is base item value + all bonuses, shown with a full breakdown.
- By default, the game also ends after 10 resolved lots. Set `ROUND_LIMIT_ENABLED` to `false` in `packages/server/src/rooms.ts` for unlimited rounds.
- Joining after a game has already started makes you an **Observer** (visible in the player list, can't bid) instead of being locked out — see "Known rough edges" below for why that matters.

## Architecture

npm workspaces monorepo, three packages:

- **`packages/shared`** — types and pure logic used by both client and server:
  - `index.ts` — core domain types (`Player`, `Round`, `RoomState`, …) and the full Socket.IO event contract.
  - `items.ts` — item template definitions (name, sprite, value range, traits, special flags).
  - `traits.ts` — trait/synergy definitions and the hidden-trait pool.
  - `scoring.ts` — end-of-game score calculation.
  - `portraits.ts` — portrait sheet grid constants.
- **`packages/server`** — Node + Express + Socket.IO:
  - `rooms.ts` — the single global room (no room codes; everyone connected plays the same game).
  - `round.ts` — the round state machine (`pending` → `active` → `resolved`) and all round economics (rebates, refunds, resolution rules).
  - `chat.ts` — capped in-memory chat history.
  - `index.ts` — wires socket events together and runs the server's tick loop (it's the authority on all timers — the client never trusts its own clock).
- **`packages/client`** — Vite + React + TypeScript:
  - `App.tsx` — owns all socket state, decides which screen to render.
  - `Game.tsx` — the in-round item card + bid button.
  - `Chat.tsx`, `PortraitIcon.tsx`, `SpriteIcon.tsx`, `Logo.tsx`, `BackgroundMusic.tsx` — focused UI pieces.
  - `sound.ts` — tiny sound-effect helper.

Real-time model: the server ticks every 100ms and broadcasts live time/bid state to everyone; the client just displays what it's told and reconciles on each tick, so nobody can cheat by faking how long they held.

## Running locally

```bash
npm install
npm run dev:server   # http://localhost:8080
npm run dev:client   # http://localhost:5173
```

Both hot-reload (`tsx watch` / Vite). The client points at the server via `packages/client/.env` (`VITE_SERVER_URL`).

## Deployment

- **Server**: hosted on Fly.io at **https://time-is-money-server.fly.dev**. `Dockerfile` + `fly.toml` live at the repo root; `fly deploy` from there redeploys it (the image only builds/runs the `server` workspace).
- **Client** ships to two static hosts, both talking to the same Fly server over `wss://`:
  - **itch.io** — `npm run build:client` (root-relative paths); zip `packages/client/dist` and upload it directly.
  - **GitHub Pages** — auto-deployed by `.github/workflows/deploy-pages.yml` on every push to `main` (uses `npm run build:pages`, which builds with base path `/time-is-money/` via `packages/client/.env.pages`). Requires repo Settings → Pages → Source = "GitHub Actions" (one-time toggle).

## Assets & content

- **Sprites** — `packages/client/public/sprites.png` is the icon sheet items are drawn from (32×32 px cells, 16 columns). **[`sprites_reference.png`](sprites_reference.png) at the repo root is an annotated copy with the index number labeled on every cell** — use it to find the right `baseSpriteId` when adding a new item in `packages/shared/src/items.ts`. Index = `row * 16 + col`, 0-indexed from the top-left.
- **Portraits** — `packages/client/public/portraits.png`, a 13×13 grid (128px cells), assigned randomly per player on join (`packages/shared/src/portraits.ts`).
- **Sounds** — `packages/client/public/sounds/`: `music/menu.mp3` (background loop) plus a bunch of `interface/*.wav` effects — only `click.wav` and `ding.wav` are wired up so far, there are more (bonus, coin, level_up, error, …) if you want to add more feedback.
- **Font** — Press Start 2P, `packages/client/src/assets/fonts/` (lives in `src/`, not `public/`, so Vite hashes/rewrites its path correctly regardless of which base path a build uses).
- Full attributions in [`CREDITS.md`](CREDITS.md).

## Known rough edges / dev-only stuff

- There's a **"Reset Game" button** (top-left, red) that force-resets the whole game from any state with no permission check — added as an escape hatch while testing softlocks (a game nobody could rejoin if everyone disconnected mid-round). Meant to come out before any wider release.
- No auth at all — being connected to the server is the only requirement to join or observe.
