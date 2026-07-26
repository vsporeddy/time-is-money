#!/usr/bin/env node
// Generates the secret used to sign player stats tokens.
//
//   npm run gen:stats-key
//
// The server both signs and verifies, so this is a single HMAC secret — there
// is no public half and nothing to publish. Nothing is written to disk; copy the
// value out of the output and treat it like any other production secret.

import { createHmac, randomBytes } from 'node:crypto';

const secret = randomBytes(32);
const encoded = secret.toString('base64');

// Same derivation the server uses, so you can match a running deployment's
// tokens to the secret that signed them.
const kid = createHmac('sha256', secret).update('time-is-money:stats-kid').digest('hex').slice(0, 16);

console.log(`
Key id (kid): ${kid}

# The signing secret. Never commit it, never send it to a client.
STATS_SIGNING_KEY=${encoded}

Local development
  Put it in your environment before starting the server:
    STATS_SIGNING_KEY='${encoded}' npm run dev:server
  Without it the server generates a throwaway secret at boot, so every restart
  invalidates every player's stats.

Deploying to Fly
  fly secrets set STATS_SIGNING_KEY='${encoded}'

Rotating
  1. Generate a new secret with this script.
  2. Move the CURRENT value of STATS_SIGNING_KEY into STATS_LEGACY_KEYS (comma
     separated if more than one), so tokens already out there keep verifying.
  3. Set STATS_SIGNING_KEY to the new secret and deploy both changes together.
  4. Drop the old secret from STATS_LEGACY_KEYS once those tokens have aged out.
     They last a year, but every finished game re-signs under the active secret.
`);
