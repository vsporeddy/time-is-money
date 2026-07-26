# Time is Money

A browser-based multiplayer party game built for a game jam (theme: **COUNT DOWN**). Time is both your clock and your currency. You spend it to bid on items, and whoever's stash is worth the most when everyone's run out of time wins.

## Running locally

```bash
npm install
npm run dev:server   # http://localhost:8080
npm run dev:client   # http://localhost:5173
```

The client points at the server via `packages/client/.env` (`VITE_SERVER_URL`).

## Deployment

- **Server**: hosted on Fly.io at **https://time-is-money-server.fly.dev**. `Dockerfile` + `fly.toml` live at the repo root; `fly deploy` from there redeploys it (the image only builds/runs the `server` workspace).
- **Client** ships to two static hosts, both talking to the same Fly server over `wss://`:
  - **itch.io** — `npm run build:client` (root-relative paths); zip `packages/client/dist` and upload it directly.
  - **GitHub Pages** — auto-deployed by `.github/workflows/deploy-pages.yml` on every push to `main` (uses `npm run build:pages`, which builds with base path `/time-is-money/` via `packages/client/.env.pages`). Requires repo Settings → Pages → Source = "GitHub Actions" (one-time toggle).
