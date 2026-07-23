import type { ItemInstance, Player, Round } from 'shared';
import { getTemplate } from 'shared';
import { SpriteIcon } from './SpriteIcon';

interface CurrentRound {
  round: Round;
  item: Omit<ItemInstance, 'trueValue'>;
}

interface LastResult {
  round: Round;
  item: ItemInstance;
}

interface GameProps {
  players: Player[];
  myId: string;
  currentRound: CurrentRound | null;
  liveTimes: Record<string, number>;
  liveBids: Record<string, number>; // playerId -> committedMs, present only while currently holding
  droppedThisRound: Record<string, number>; // playerId -> committedMs, present once they've folded this round
  lastResult: LastResult | null;
  onHoldStart: () => void;
  onHoldRelease: () => void;
}

function fmt(ms: number) {
  return (Math.max(0, ms) / 1000).toFixed(1) + 's';
}

export function Game({
  players,
  myId,
  currentRound,
  liveTimes,
  liveBids,
  droppedThisRound,
  lastResult,
  onHoldStart,
  onHoldRelease,
}: GameProps) {
  const isHolding = (id: string) => liveBids[id] !== undefined;
  const isDropped = (id: string) => droppedThisRound[id] !== undefined;

  const iHaveDropped = isDropped(myId);
  const iAmHolding = isHolding(myId);
  const myTime = liveTimes[myId] ?? players.find((p) => p.id === myId)?.timeRemainingMs ?? 0;
  const canHold = currentRound?.round.status === 'active' && !iHaveDropped && myTime > 0;

  return (
    <div>
      <ul style={{ listStyle: 'none', padding: 0, display: 'flex', gap: 16, flexWrap: 'wrap' }}>
        {players.map((p) => {
          const holding = isHolding(p.id);
          const dropped = isDropped(p.id);
          const isMe = p.id === myId;
          const time = liveTimes[p.id] ?? p.timeRemainingMs;
          return (
            <li
              key={p.id}
              style={{
                padding: '8px 12px',
                borderRadius: 8,
                background: holding ? '#2a4' : dropped ? '#333' : '#222',
                opacity: dropped ? 0.6 : 1,
                border: isMe ? '2px solid #fff' : '2px solid transparent',
              }}
            >
              <div>{p.name}{isMe ? ' (you)' : ''}</div>
              <div>{fmt(time)} left</div>
              {holding && <div>holding {fmt(liveBids[p.id])}</div>}
              {dropped && <div>folded — spent {fmt(droppedThisRound[p.id])}</div>}
            </li>
          );
        })}
      </ul>

      {lastResult && (
        <div style={{ marginTop: 24, padding: 16, background: '#222', borderRadius: 8 }}>
          <h3>SOLD</h3>
          <p>
            {getTemplate(lastResult.item.templateId)?.name} ({lastResult.item.material}, {lastResult.item.rarity}) — true
            value ${lastResult.item.trueValue}
          </p>
          <p>
            {lastResult.round.winnerId
              ? `Won by ${players.find((p) => p.id === lastResult.round.winnerId)?.name ?? 'someone'}`
              : 'No one held on — item goes unclaimed.'}
          </p>
          <p>Next lot incoming…</p>
        </div>
      )}

      {!lastResult && currentRound && (
        <div style={{ marginTop: 24, padding: 16, background: '#222', borderRadius: 8, textAlign: 'center' }}>
          <SpriteIcon index={Number(currentRound.item.visual.baseSpriteId)} scale={4} />
          <h3>{getTemplate(currentRound.item.templateId)?.name}</h3>
          <p>
            {currentRound.item.material} · {currentRound.item.rarity} · value: ???
          </p>

          {currentRound.round.status === 'pending' && <p>Get ready…</p>}

          {currentRound.round.status === 'active' && (
            <>
              <button
                disabled={!canHold}
                onPointerDown={canHold ? onHoldStart : undefined}
                onPointerUp={onHoldRelease}
                onPointerLeave={onHoldRelease}
                onPointerCancel={onHoldRelease}
                style={{
                  fontSize: '1.5rem',
                  padding: '16px 32px',
                  borderRadius: 12,
                  background: iAmHolding ? '#c33' : '#357',
                  color: '#fff',
                  border: 'none',
                }}
              >
                {iHaveDropped ? 'Folded' : iAmHolding ? 'Holding…' : 'Hold to bid'}
              </button>
              {iAmHolding && <p>Spending: {fmt(liveBids[myId])}</p>}
            </>
          )}
        </div>
      )}
    </div>
  );
}
