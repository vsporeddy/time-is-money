import { getClassDefinition } from 'shared';
import type { PlayerStats } from 'shared';

interface PlayerStatsViewProps {
  stats: PlayerStats | null;
  isSelf: boolean;
}

function fmtSeconds(ms: number): string {
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`;
  return `${Math.floor(ms / 60_000)}m ${Math.round((ms % 60_000) / 1000)}s`;
}

function percent(part: number, whole: number): string {
  return whole === 0 ? '—' : `${Math.round((part / whole) * 100)}%`;
}

function favouriteClass(stats: PlayerStats): string | null {
  const entries = Object.entries(stats.classGames);
  if (entries.length === 0) return null;
  const [classId, games] = entries.reduce((best, entry) => (entry[1] > best[1] ? entry : best));
  const wins = stats.classWins[classId] ?? 0;
  return `${getClassDefinition(classId)?.name ?? classId} — ${games}g, ${wins}w`;
}

/**
 * The RECORD tab of an inventory panel. Your own record is decoded from the
 * signed token in localStorage, everyone else's comes from the server — either
 * way it is only rendered once it checks out, so nothing here flags it.
 */
export function PlayerStatsView({ stats, isSelf }: PlayerStatsViewProps) {
  if (!stats) {
    return (
      <p className="status-line">
        {isSelf ? 'Finish a game and your record starts here.' : 'No record yet — this is their first game.'}
      </p>
    );
  }

  const games = stats.gamesFinished;
  const lines: { label: string; value: string }[] = [
    { label: 'Games finished', value: String(games) },
    { label: 'Wins', value: `${stats.wins} (${percent(stats.wins, games)})` },
    { label: 'Top 3 finishes', value: String(stats.podiums) },
    { label: 'Best score', value: `$${stats.bestScore}` },
    { label: 'Average score', value: games === 0 ? '—' : `$${Math.round(stats.totalScore / games)}` },
    { label: 'Lots won', value: String(stats.lotsWon) },
    { label: 'Items collected', value: String(stats.itemsCollected) },
    { label: 'Time spent bidding', value: fmtSeconds(stats.timeSpentMs) },
    { label: 'Time left over', value: fmtSeconds(stats.timeRemainingMs) },
    { label: 'Ran out of time', value: `${stats.outOfTimeCount}×` },
  ];
  const favourite = favouriteClass(stats);

  return (
    <div className="stats-tab">
      <ul className="stats-list">
        {lines.map((line) => (
          <li key={line.label}>
            <span className="stats-label">{line.label}</span>
            <span className="stats-value">{line.value}</span>
          </li>
        ))}
        {favourite && (
          <li>
            <span className="stats-label">Most played class</span>
            <span className="stats-value">{favourite}</span>
          </li>
        )}
      </ul>
    </div>
  );
}
