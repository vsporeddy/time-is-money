// End-to-end bot-only game against the real timer-driven loop: real
// scheduleBotEntries / scheduleBotReleases, real round state machine, real
// tickRoom. Verifies the parts bot-sim.ts can't — the nerve tick loop,
// stalemates, and self-elimination.
//
//   npx tsx scripts/bot-game-sim.ts [games]
//
import { computeScores } from 'shared';
import { addBot } from '../src/bots.js';
import { createRoomObject } from '../src/rooms.js';
import type { IO, Room } from '../src/rooms.js';
import { startGame, tickRoom } from '../src/round.js';

const io = {
  to: () => ({ emit: () => {} }),
  emit: () => {},
} as unknown as IO;

interface RoundRecord {
  roundId: string;
  winner: string | null;
  stalemate: boolean;
  holds: { name: string; ms: number }[];
}

function playGame(gameIndex: number): Promise<RoundRecord[]> {
  const room: Room = createRoomObject(`SIM${gameIndex}`);
  for (let i = 0; i < 3; i += 1) addBot(room);
  // Squeeze the dead time; leave maxRoundDurationMs alone so a stalemate still
  // means what it means.
  room.settings.pendingDurationMs = 100;
  room.settings.noBidTimeoutMs = 800;
  room.settings.interRoundDelayMs = 100;

  const records: RoundRecord[] = [];
  const seen = new Set<string>();
  startGame(room, io);

  return new Promise((resolve) => {
    const timer = setInterval(() => {
      tickRoom(room, io);

      const ar = room.activeRound;
      if (ar && ar.round.status === 'resolved' && !seen.has(ar.round.id)) {
        seen.add(ar.round.id);
        records.push({
          roundId: ar.round.id,
          winner: ar.round.winnerId ? room.players.get(ar.round.winnerId)?.name ?? null : null,
          stalemate: ar.round.stalematePlayerIds.length > 0,
          holds: Object.entries(ar.round.bidders)
            .filter(([, bidder]) => bidder.committedMs > 0)
            .map(([id, bidder]) => ({ name: room.players.get(id)?.name ?? id, ms: bidder.committedMs })),
        });
      }

      if (room.status === 'game_over') {
        clearInterval(timer);
        console.log(`\n--- game ${gameIndex} ---`);
        for (const record of records) {
          const holds = record.holds.map((h) => `${h.name} ${h.ms}ms`).join(', ') || 'no bids';
          console.log(
            `  ${record.roundId.padEnd(9)} ${record.stalemate ? 'STALEMATE' : (record.winner ?? 'passed').padEnd(12)}  ${holds}`
          );
        }
        const seats = [...room.players.values()];
        const scores = computeScores(seats, room.wonItems, room.itemPricePaidMs);
        for (const [index, player] of seats.entries()) {
          console.log(
            `  = ${player.name.padEnd(12)} ${String(player.timeRemainingMs).padStart(6)}ms left` +
            `  ${player.stash.length} items  score ${String(scores[index].total).padStart(4)}  ${player.status}`
          );
        }
        // Machine-readable line for the abstract simulator's calibration check.
        console.log(`CALIBRATION ${JSON.stringify({
          rounds: records.length,
          contested: records.filter((r) => r.holds.length > 1).length,
          passed: records.filter((r) => r.winner === null && !r.stalemate).length,
          stalemates: records.filter((r) => r.stalemate).length,
          holds: records.flatMap((r) => r.holds.map((h) => h.ms)),
          scores: scores.map((s) => s.total),
          items: seats.map((p) => p.stash.length),
          timeLeft: seats.map((p) => p.timeRemainingMs),
        })}`);
        resolve(records);
      }
    }, 100);
  });
}

const games = Number(process.argv[2] ?? 3);
const all: RoundRecord[] = [];
for (let i = 1; i <= games; i += 1) all.push(...(await playGame(i)));

const contested = all.filter((record) => record.holds.length > 1);
const stalemates = all.filter((record) => record.stalemate);
const spreads = contested.map((record) => {
  const times = record.holds.map((hold) => hold.ms);
  return Math.max(...times) - Math.min(...times);
});

console.log('\n=== summary ===');
console.log(`  rounds:      ${all.length}`);
console.log(`  contested:   ${contested.length}`);
console.log(`  stalemates:  ${stalemates.length}  (must be rare; 60s buzzer means the loop never fired)`);
console.log(
  `  hold spread within a contested round: mean ${(spreads.reduce((sum, value) => sum + value, 0) / Math.max(1, spreads.length)).toFixed(0)}ms` +
  `  max ${Math.max(0, ...spreads)}ms`
);
