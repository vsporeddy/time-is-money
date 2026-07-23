import { useEffect, useState } from 'react';
import type { FormEvent, ReactNode } from 'react';
import type { ItemInstance, Player, Round, RoomState } from 'shared';
import { socket } from './socket';
import { SpriteIcon } from './SpriteIcon';
import { Game } from './Game';

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
    const onGameOver = (payload: { players: Player[] }) => setGameOverPlayers(payload.players);

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

  const shell = (children: ReactNode) => (
    <main style={{ fontFamily: 'sans-serif', padding: '2rem', color: '#eee', background: '#111', minHeight: '100vh' }}>
      <h1>Time is Money</h1>
      {children}
    </main>
  );

  if (!joined) {
    return shell(
      <>
        <div style={{ display: 'flex', gap: 4, marginBottom: '1rem' }}>
          {[0, 1, 2, 3, 4, 5, 6, 7].map((i) => (
            <SpriteIcon key={i} index={i} scale={2} />
          ))}
        </div>
        <p>{connected ? 'Connected to server' : 'Connecting…'}</p>
        <form onSubmit={handleJoin} style={{ display: 'flex', gap: 8 }}>
          <input placeholder="Your name" value={name} onChange={(e) => setName(e.target.value)} />
          <input
            placeholder="Room code"
            value={roomCode}
            onChange={(e) => setRoomCode(e.target.value.toUpperCase())}
          />
          <button type="submit" disabled={!connected}>
            Join
          </button>
        </form>
        {error && <p style={{ color: '#f66' }}>{error}</p>}
      </>
    );
  }

  if (gameOverPlayers) {
    const ranked = [...gameOverPlayers]
      .map((p) => ({
        ...p,
        totalValue: p.stash.reduce((sum, itemId) => sum + (knownItems[itemId]?.trueValue ?? 0), 0),
      }))
      .sort((a, b) => b.totalValue - a.totalValue);

    return shell(
      <>
        <h2>Game Over</h2>
        <ol>
          {ranked.map((p) => (
            <li key={p.id}>
              {p.name}{p.id === myId ? ' (you)' : ''} — ${p.totalValue} ({p.stash.length} item{p.stash.length === 1 ? '' : 's'})
            </li>
          ))}
        </ol>
      </>
    );
  }

  if (!room) return shell(<p>Loading…</p>);

  if (room.status === 'lobby') {
    return shell(
      <>
        <h2>Room {room.code}</h2>
        <ul>
          {room.players.map((p) => (
            <li key={p.id}>
              {p.name}
              {p.id === myId ? ' (you)' : ''} — {(p.timeRemainingMs / 1000).toFixed(0)}s
            </li>
          ))}
        </ul>
        <button onClick={() => socket.emit('start_game')}>Start Game</button>
      </>
    );
  }

  return shell(
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
