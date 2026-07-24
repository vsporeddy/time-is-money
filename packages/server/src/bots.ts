import type { Server } from 'socket.io';
import type { ClientToServerEvents, Player, ServerToClientEvents } from 'shared';
import { MAX_BOTS, randomPortraitIndex } from 'shared';
import type { Room } from './rooms.js';

type IO = Server<ClientToServerEvents, ServerToClientEvents>;
type HoldFn = (room: Room, playerId: string, io: IO) => void;

const BOT_NAMES = [
  'Chowder', 'Zalteo', 'Roffles', 'Spatika', 'Paperlisk',
  'Silverwing', 'Misder', 'Asura', 'Iron Urn', 'Phantah',
  'Doncha', 'Strawberry', 'Sapphice', 'Quasar', 'Chewpin',
  'TimmahC', 'Oxray', 'Audacity', 'BC Guy', 'Learnt',
];

let botCounter = 0;

function pickBotName(room: Room): string {
  const taken = new Set([...room.players.values()].filter((p) => p.isBot).map((p) => p.name));
  const available = BOT_NAMES.filter((name) => !taken.has(name));
  const pool = available.length > 0 ? available : BOT_NAMES;
  return pool[Math.floor(Math.random() * pool.length)];
}

export function addBot(room: Room): Player | null {
  if (room.status !== 'lobby') return null;

  const botCount = [...room.players.values()].filter((p) => p.isBot).length;
  if (botCount >= MAX_BOTS) return null;

  botCounter += 1;
  const id = `bot-${botCounter}`;
  const bot: Player = {
    id,
    name: pickBotName(room),
    timeRemainingMs: room.settings.startingTimeMs,
    status: 'active',
    stash: [],
    connected: true,
    portraitIndex: randomPortraitIndex(),
    isObserver: false,
    isBot: true,
  };
  room.players.set(id, bot);
  return bot;
}

// A bot sits out roughly 30% of lots, and otherwise enters after a small
// randomized delay so a room full of bots doesn't react in perfect lockstep.
const BID_CHANCE = 0.7;
const MIN_ENTRY_DELAY_MS = 200;
const ENTRY_DELAY_SAFETY_MARGIN_MS = 150; // stay clear of the window's own close

// Called once the opt-in window opens — each bot independently rolls whether
// to enter this lot at all.
export function scheduleBotEntries(room: Room, io: IO, handleHoldStart: HoldFn) {
  const ar = room.activeRound;
  if (!ar) return;

  for (const player of room.players.values()) {
    if (!player.isBot || !ar.round.bidders[player.id]) continue;
    if (Math.random() >= BID_CHANCE) continue;

    const windowMs = room.settings.noBidTimeoutMs;
    const latestDelay = Math.max(MIN_ENTRY_DELAY_MS, windowMs - ENTRY_DELAY_SAFETY_MARGIN_MS);
    const entryDelay = MIN_ENTRY_DELAY_MS + Math.random() * Math.max(0, latestDelay - MIN_ENTRY_DELAY_MS);

    setTimeout(() => {
      if (room.activeRound !== ar) return; // round moved on before this fired
      handleHoldStart(room, player.id, io);
    }, entryDelay);
  }
}

// An arbitrary amount of time to spend before withdrawing, once spending has
// actually started — capped by whatever time the bot has left.
const MIN_HOLD_MS = 300;
const MAX_HOLD_MS = 9_000;
const HOLD_SAFETY_MARGIN_MS = 100;

// Called once the window closes and spending actually starts — every bot
// still holding at this point picks how long to hang on, then withdraws.
export function scheduleBotReleases(room: Room, io: IO, handleHoldRelease: HoldFn) {
  const ar = room.activeRound;
  if (!ar) return;

  for (const [playerId, bidder] of Object.entries(ar.round.bidders)) {
    const player = room.players.get(playerId);
    if (!player?.isBot || !bidder.isHolding) continue;

    const holdMs = Math.min(
      MIN_HOLD_MS + Math.random() * (MAX_HOLD_MS - MIN_HOLD_MS),
      Math.max(HOLD_SAFETY_MARGIN_MS, player.timeRemainingMs - HOLD_SAFETY_MARGIN_MS)
    );

    setTimeout(() => {
      if (room.activeRound !== ar) return;
      handleHoldRelease(room, playerId, io);
    }, holdMs);
  }
}
