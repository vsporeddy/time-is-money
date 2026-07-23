import { useEffect, useState } from 'react';
import type { FormEvent, ReactNode } from 'react';
import type { ItemInstance, Player, Round, RoomState, ScoreBreakdown } from 'shared';
import { getTemplate, getTraitDefinition } from 'shared';
import { socket } from './socket';
import { Logo } from './Logo';
import { Game } from './Game';
import { PortraitIcon } from './PortraitIcon';

interface CurrentRound {
  round: Round;
  item: Omit<ItemInstance, 'trueValue'>;
}

interface LastResult {
  round: Round;
  item: ItemInstance;
}

export default function App() {
  const [connected, setConnected] = useState(false);
  const [joined, setJoined] = useState(false);
  const [myId, setMyId] = useState<string | null>(null);
  const [name, setName] = useState('');
  const [roomCode, setRoomCode] = useState('');
  const [room, setRoom] = useState<RoomState | null>(null);
  const [error, setError] = useState<string | null>(null);

  const [currentRound, setCurrentRound] = useState<CurrentRound | null>(null);
  const [liveTimes, setLiveTimes] = useState<Record<string, number>>({});
  const [liveBids, setLiveBids] = useState<Record<string, number>>({});
  const [droppedThisRound, setDroppedThisRound] = useState<Record<string, number>>({});
  const [lastResult, setLastResult] = useState<LastResult | null>(null);
  const [knownItems, setKnownItems] = useState<Record<string, ItemInstance>>({});
  const [gameOverPlayers, setGameOverPlayers] = useState<Player[] | null>(null);
  const [scores, setScores] = useState<ScoreBreakdown[] | null>(null);

  useEffect(() => {
    socket.connect();

    const onConnect = () => setConnected(true);
    const onDisconnect = () => setConnected(false);
    const onRoomState = (state: RoomState) => setRoom(state);
    const onRoundStart = (payload: CurrentRound) => {
      setCurrentRound(payload);
      setLastResult(null);
      setLiveBids({});
      setDroppedThisRound({});
    };
    const onRoundTick = (payload: { players: Record<string, number>; bidders: Record<string, number> }) => {
      setLiveTimes(payload.players);
      setLiveBids(payload.bidders);
    };
    const onBidderDropped = (payload: { roundId: string; playerId: string; committedMs: number }) => {
      setDroppedThisRound((prev) => ({ ...prev, [payload.playerId]: payload.committedMs }));
      setLiveBids((prev) => {
        const next = { ...prev };
        delete next[payload.playerId];
        return next;
      });
    };
    const onRoundEnd = (payload: LastResult) => {
      setLastResult(payload);
      setCurrentRound(null);
      setKnownItems((prev) => ({ ...prev, [payload.item.id]: payload.item }));
    };
    const onGameOver = (payload: { players: Player[]; scores: ScoreBreakdown[] }) => {
      setGameOverPlayers(payload.players);
      setScores(payload.scores);
    };

    socket.on('connect', onConnect);
    socket.on('disconnect', onDisconnect);
    socket.on('room_state', onRoomState);
    socket.on('round_start', onRoundStart);
    socket.on('round_tick', onRoundTick);
    socket.on('bidder_dropped', onBidderDropped);
    socket.on('round_end', onRoundEnd);
    socket.on('game_over', onGameOver);

    return () => {
      socket.off('connect', onConnect);
      socket.off('disconnect', onDisconnect);
      socket.off('room_state', onRoomState);
      socket.off('round_start', onRoundStart);
      socket.off('round_tick', onRoundTick);
      socket.off('bidder_dropped', onBidderDropped);
      socket.off('round_end', onRoundEnd);
      socket.off('game_over', onGameOver);
      socket.disconnect();
    };
  }, []);

  const handleJoin = (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    socket.emit('join_room', { roomCode, playerName: name }, (res) => {
      if (res.ok) {
        setJoined(true);
        setMyId(res.playerId);
      } else {
        setError(res.error);
      }
    });
  };

  const shellWithHeader = (children: ReactNode) => (
    <main className="app-shell">
      <div className="top-bar">
        <Logo scale={2} />
      </div>
      {children}
    </main>
  );

  if (!joined) {
    return (
      <main className="app-shell">
        <Logo scale={5} />
        <div className="panel">
          <p className="status-line">{connected ? 'Connected to server' : 'Connecting…'}</p>
          <form onSubmit={handleJoin}>
            <div className="field">
              <label htmlFor="name">Your name</label>
              <input id="name" type="text" value={name} onChange={(e) => setName(e.target.value)} />
            </div>
            <div className="field">
              <label htmlFor="roomCode">Room code</label>
              <input
                id="roomCode"
                type="text"
                value={roomCode}
                onChange={(e) => setRoomCode(e.target.value.toUpperCase())}
              />
            </div>
            <button type="submit" className="btn btn-block" disabled={!connected}>
              Join
            </button>
          </form>
          {error && <p className="error-text">{error}</p>}
        </div>
      </main>
    );
  }

  if (gameOverPlayers && scores) {
    const ranked = [...scores].sort((a, b) => b.total - a.total);

    return shellWithHeader(
      <div className="panel">
        <h2 className="panel-title">Game Over</h2>
        <ol className="results-list">
          {ranked.map((s) => {
            const player = gameOverPlayers.find((p) => p.id === s.playerId);
            const itemNames = (player?.stash ?? [])
              .map((id) => knownItems[id])
              .filter((item): item is ItemInstance => Boolean(item))
              .map((item) => getTemplate(item.templateId)?.name ?? item.templateId);

            const extras: string[] = [];
            if (s.hiddenTraitBonus !== 0) extras.push(`hidden ${s.hiddenTraitBonus >= 0 ? '+' : ''}${s.hiddenTraitBonus}`);
            if (s.scoreScalingBonus !== 0) extras.push(`scaling +${s.scoreScalingBonus}`);
            if (s.lonerBonus !== 0) extras.push(`loner +${s.lonerBonus}`);
            for (const t of s.traitBonuses) {
              extras.push(`${getTraitDefinition(t.traitId)?.name ?? t.traitId} x${t.count} +${t.bonus}`);
            }

            return (
              <li key={s.playerId} className="results-item">
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
                  {player && <PortraitIcon index={player.portraitIndex} size={40} />}
                  <div>
                    <div className="rank-total">
                      {player?.name}
                      {s.playerId === myId ? ' (you)' : ''} — ${s.total}
                    </div>
                    <div className="rank-breakdown">
                      base ${s.baseValue}
                      {extras.length > 0 ? `, ${extras.join(', ')}` : ''}
                    </div>
                    {itemNames.length > 0 && <div className="rank-items">{itemNames.join(', ')}</div>}
                  </div>
                </div>
              </li>
            );
          })}
        </ol>
      </div>
    );
  }

  if (!room) return shellWithHeader(<p className="status-line">Loading…</p>);

  if (room.status === 'lobby') {
    return shellWithHeader(
      <div className="panel">
        <h2 className="panel-title">Room {room.code}</h2>
        <ul className="player-row">
          {room.players.map((p) => (
            <li key={p.id} className={`player-card${p.id === myId ? ' me' : ''}`}>
              <PortraitIcon index={p.portraitIndex} />
              <div className="name">
                {p.name}
                {p.id === myId ? ' (you)' : ''}
              </div>
              <div>{(p.timeRemainingMs / 1000).toFixed(0)}s</div>
            </li>
          ))}
        </ul>
        <button className="btn btn-block" style={{ marginTop: '1rem' }} onClick={() => socket.emit('start_game')}>
          Start Game
        </button>
      </div>
    );
  }

  return shellWithHeader(
    <Game
      players={room.players}
      myId={myId!}
      currentRound={currentRound}
      liveTimes={liveTimes}
      liveBids={liveBids}
      droppedThisRound={droppedThisRound}
      lastResult={lastResult}
      onHoldStart={() => socket.emit('hold_start')}
      onHoldRelease={() => socket.emit('hold_release')}
    />
  );
}
