import { useEffect, useMemo, useRef, useState } from 'react';
import type { FormEvent, ReactNode } from 'react';
import type { ChatMessage, ItemInstance, MaskedRoundItem, Player, Round, RoomState, ScoreBreakdown } from 'shared';
import { MAX_BOTS, computeScores, getTemplate, getTraitDefinition } from 'shared';
import { socket } from './socket';
import { Logo } from './Logo';
import { Game } from './Game';
import { PortraitIcon } from './PortraitIcon';
import { Chat } from './Chat';
import { BackgroundMusic } from './BackgroundMusic';
import { Inventory } from './Inventory';
import { ItemTargetPicker } from './ItemTargetPicker';
import { PlayerPicker } from './PlayerPicker';
import { playChatDing, playClick, playLose, playWin } from './sound';

interface CurrentRound {
  round: Round;
  item: MaskedRoundItem;
}

interface LastResult {
  round: Round;
  item: ItemInstance;
}

export default function App() {
  const [connected, setConnected] = useState(false);
  const [joined, setJoined] = useState(false);
  const [myId, setMyId] = useState<string | null>(null);
  const myIdRef = useRef<string | null>(null);
  useEffect(() => {
    myIdRef.current = myId;
  }, [myId]);
  // Withdrawing as the last remaining bidder actually wins the lot (see
  // handleHoldRelease in round.ts). Suppress the "lose" cue for that case
  // so it doesn't play right before the "win" cue.
  const suppressNextLoseRef = useRef(false);
  const [name, setName] = useState('');
  const [room, setRoom] = useState<RoomState | null>(null);
  const [error, setError] = useState<string | null>(null);

  const [currentRound, setCurrentRound] = useState<CurrentRound | null>(null);
  const [liveTimes, setLiveTimes] = useState<Record<string, number>>({});
  const [liveBids, setLiveBids] = useState<Record<string, number>>({});
  const [holdingPlayerIds, setHoldingPlayerIds] = useState<string[]>([]);
  const [droppedThisRound, setDroppedThisRound] = useState<Record<string, number>>({});
  const [lastResult, setLastResult] = useState<LastResult | null>(null);
  const [knownItems, setKnownItems] = useState<Record<string, ItemInstance>>({});
  const [itemPrices, setItemPrices] = useState<Record<string, number>>({});
  const [gameOverPlayers, setGameOverPlayers] = useState<Player[] | null>(null);
  const [scores, setScores] = useState<ScoreBreakdown[] | null>(null);
  const [chatMessages, setChatMessages] = useState<ChatMessage[]>([]);
  const [selectedOpponentId, setSelectedOpponentId] = useState<string | null>(null);
  const [myInventoryOpen, setMyInventoryOpen] = useState(true);
  const [roundLimit, setRoundLimit] = useState(10);
  // Mirror of Desire (copy) and Crossbow (destroy) both target an item in
  // someone else's inventory — one picker overlay serves both.
  const [itemPickerItemId, setItemPickerItemId] = useState<string | null>(null);
  const [itemPickerError, setItemPickerError] = useState<string | null>(null);
  // Dual Daggers and Wooden Dagger target a player directly.
  const [playerPickerItemId, setPlayerPickerItemId] = useState<string | null>(null);
  const [playerPickerError, setPlayerPickerError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  useEffect(() => {
    if (!actionError) return;
    const timer = window.setTimeout(() => setActionError(null), 3500);
    return () => window.clearTimeout(timer);
  }, [actionError]);

  useEffect(() => {
    socket.connect();

    const onConnect = () => setConnected(true);
    const onDisconnect = () => setConnected(false);
    const onRoomState = (state: RoomState) => {
      setRoom(state);
      setKnownItems((previous) => ({
        ...previous,
        ...Object.fromEntries(state.knownItems.map((item) => [item.id, item])),
      }));
      setItemPrices((previous) => ({ ...previous, ...state.itemPrices }));
      if (state.settings.maxRounds !== null) setRoundLimit(state.settings.maxRounds);
      if (state.status === 'lobby') {
        // Covers restart_game bringing us back here — clear out the last game's view.
        setGameOverPlayers(null);
        setScores(null);
        setKnownItems({});
        setItemPrices({});
        setLastResult(null);
        setCurrentRound(null);
      }
      if (selectedOpponentId && !state.players.some((player) => player.id === selectedOpponentId)) {
        setSelectedOpponentId(null);
      }
    };
    const onRoundStart = (payload: CurrentRound) => {
      setCurrentRound((current) =>
        current?.round.id === payload.round.id ? { ...payload, item: { ...current.item, ...payload.item } } : payload
      );
      setLastResult(null);
      setLiveBids({});
      setHoldingPlayerIds([]);
      setDroppedThisRound({});
    };
    const onBidWindowClosed = ({ roundId, spendingStartedAt }: { roundId: string; spendingStartedAt: number }) => {
      setCurrentRound((current) =>
        current?.round.id === roundId
          ? { ...current, round: { ...current.round, bidWindowOpen: false, spendingStartedAt } }
          : current
      );
    };
    const onReveal = ({ roundId, field, value }: { roundId: string; field: string; value: string | number }) => {
      if (field !== 'material' && field !== 'rarity' && field !== 'specialModifier') return;
      setCurrentRound((current) =>
        current?.round.id === roundId
          ? { ...current, item: { ...current.item, [field]: String(value) } }
          : current
      );
    };
    // Arcane Staff: the lot itself changed — replace wholesale, don't merge
    // with the old item's already-revealed fields.
    const onLotTransformed = (payload: { roundId: string; item: MaskedRoundItem }) => {
      setCurrentRound((current) => (current?.round.id === payload.roundId ? { ...current, item: payload.item } : current));
    };
    const onBidRestricted = (payload: { roundId: string; allowedPlayerIds: string[] }) => {
      setCurrentRound((current) =>
        current?.round.id === payload.roundId
          ? { ...current, round: { ...current.round, restrictedBidderIds: payload.allowedPlayerIds } }
          : current
      );
    };
    const onBidderCancelled = ({ playerId }: { roundId: string; playerId: string }) => {
      setLiveBids((previous) => {
        const next = { ...previous };
        delete next[playerId];
        return next;
      });
    };
    const onRoundTick = (payload: { players: Record<string, number>; bidders: Record<string, number>; holding: string[] }) => {
      setLiveTimes(payload.players);
      setLiveBids(payload.bidders);
      setHoldingPlayerIds(payload.holding);
    };
    const onBidderDropped = (payload: { roundId: string; playerId: string; committedMs: number }) => {
      setDroppedThisRound((prev) => ({ ...prev, [payload.playerId]: payload.committedMs }));
      setLiveBids((prev) => {
        const next = { ...prev };
        delete next[payload.playerId];
        return next;
      });
      if (payload.playerId === myIdRef.current) {
        if (suppressNextLoseRef.current) {
          suppressNextLoseRef.current = false;
        } else {
          playLose();
        }
      }
    };
    const onRoundEnd = (payload: LastResult) => {
      setLastResult(payload);
      setCurrentRound(null);
      setLiveTimes({});
      setLiveBids({});
      setKnownItems((prev) => ({ ...prev, [payload.item.id]: payload.item }));
      if (payload.round.winnerId) {
        setItemPrices((previous) => ({
          ...previous,
          [payload.item.id]: payload.round.bidders[payload.round.winnerId!]?.committedMs ?? 0,
        }));
        if (payload.round.winnerId === myIdRef.current) playWin();
      }
    };
    const onGameOver = (payload: { players: Player[]; scores: ScoreBreakdown[] }) => {
      setGameOverPlayers(payload.players);
      setScores(payload.scores);
    };
    const onChatHistory = (history: ChatMessage[]) => setChatMessages(history);
    const onChatMessage = (message: ChatMessage) => {
      playChatDing();
      setChatMessages((prev) => [...prev, message].slice(-100));
    };

    socket.on('connect', onConnect);
    socket.on('disconnect', onDisconnect);
    socket.on('room_state', onRoomState);
    socket.on('round_start', onRoundStart);
    socket.on('reveal', onReveal);
    socket.on('lot_transformed', onLotTransformed);
    socket.on('bid_restricted', onBidRestricted);
    socket.on('bid_window_closed', onBidWindowClosed);
    socket.on('bidder_cancelled', onBidderCancelled);
    socket.on('round_tick', onRoundTick);
    socket.on('bidder_dropped', onBidderDropped);
    socket.on('round_end', onRoundEnd);
    socket.on('game_over', onGameOver);
    socket.on('chat_history', onChatHistory);
    socket.on('chat_message', onChatMessage);

    return () => {
      socket.off('connect', onConnect);
      socket.off('disconnect', onDisconnect);
      socket.off('room_state', onRoomState);
      socket.off('round_start', onRoundStart);
      socket.off('reveal', onReveal);
      socket.off('lot_transformed', onLotTransformed);
      socket.off('bid_restricted', onBidRestricted);
      socket.off('bid_window_closed', onBidWindowClosed);
      socket.off('bidder_cancelled', onBidderCancelled);
      socket.off('round_tick', onRoundTick);
      socket.off('bidder_dropped', onBidderDropped);
      socket.off('round_end', onRoundEnd);
      socket.off('game_over', onGameOver);
      socket.off('chat_history', onChatHistory);
      socket.off('chat_message', onChatMessage);
      socket.disconnect();
    };
  }, []);

  const handleJoin = (e: FormEvent) => {
    e.preventDefault();
    playClick();
    setError(null);
    socket.emit('join_room', { playerName: name }, (res) => {
      if (res.ok) {
        setJoined(true);
        setMyId(res.playerId);
      } else {
        setError(res.error);
      }
    });
  };

  const handleResetGame = () => {
    playClick();
    if (window.confirm('Reset the game for everyone? This clears all progress.')) {
      socket.emit('reset_game');
    }
  };

  // Wooden Shield grants blanket immunity to every other player's weapon effects.
  const isImmune = (playerId: string) =>
    room?.players.find((p) => p.id === playerId)?.stash.some((id) => knownItems[id]?.templateId === 'wooden-shield') ?? false;

  // Dispatches a click on a usable inventory item to the right UI: an item
  // picker (copy/destroy), a player picker (force-enter/force-withdraw one),
  // or straight to the server for effects with no target to choose.
  const handleUseItem = (itemId: string) => {
    const item = knownItems[itemId];
    const template = item ? getTemplate(item.templateId) : undefined;
    if (!template) return;
    playClick();

    if (template.effectType === 'copyItem' || template.effectType === 'destroyItem') {
      setItemPickerError(null);
      setItemPickerItemId(itemId);
      return;
    }

    if (template.weapon?.target === 'one') {
      setPlayerPickerError(null);
      setPlayerPickerItemId(itemId);
      return;
    }

    socket.emit('use_weapon', { itemId }, (res) => {
      if (!res.ok) setActionError(res.error);
    });
  };

  const itemPickerItem = itemPickerItemId ? knownItems[itemPickerItemId] : undefined;
  const itemPickerTemplate = itemPickerItem ? getTemplate(itemPickerItem.templateId) : undefined;
  const itemPickerMode: 'copy' | 'destroy' = itemPickerTemplate?.effectType === 'destroyItem' ? 'destroy' : 'copy';

  const handleItemPickerSelect = (targetPlayerId: string, targetItemId: string) => {
    if (!itemPickerItemId) return;
    if (itemPickerMode === 'destroy') {
      socket.emit('use_weapon', { itemId: itemPickerItemId, targetPlayerId, targetItemId }, (res) => {
        if (res.ok) {
          setItemPickerItemId(null);
          setItemPickerError(null);
        } else {
          setItemPickerError(res.error);
        }
      });
    } else {
      socket.emit('use_mirror', { itemId: itemPickerItemId, copyItemId: targetItemId }, (res) => {
        if (res.ok) {
          setItemPickerItemId(null);
          setItemPickerError(null);
        } else {
          setItemPickerError(res.error);
        }
      });
    }
  };

  const handleItemPickerCancel = () => {
    setItemPickerItemId(null);
    setItemPickerError(null);
  };

  const playerPickerItem = playerPickerItemId ? knownItems[playerPickerItemId] : undefined;
  const playerPickerTemplate = playerPickerItem ? getTemplate(playerPickerItem.templateId) : undefined;

  const playerPickerCandidates = useMemo(() => {
    if (!playerPickerTemplate?.weapon || !room) return [];
    if (playerPickerTemplate.effectType === 'forceEnter') {
      const bidders = currentRound?.round.bidders;
      if (!bidders) return [];
      return room.players.filter((p) => p.id !== myId && bidders[p.id] && bidders[p.id].droppedAt === null && !isImmune(p.id));
    }
    if (playerPickerTemplate.effectType === 'forceWithdraw') {
      return room.players.filter((p) => p.id !== myId && liveBids[p.id] !== undefined && !isImmune(p.id));
    }
    return [];
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [playerPickerTemplate, room, currentRound, liveBids, myId, knownItems]);

  const handlePlayerPickerSelect = (targetPlayerId: string) => {
    if (!playerPickerItemId) return;
    socket.emit('use_weapon', { itemId: playerPickerItemId, targetPlayerId }, (res) => {
      if (res.ok) {
        setPlayerPickerItemId(null);
        setPlayerPickerError(null);
      } else {
        setPlayerPickerError(res.error);
      }
    });
  };

  const handlePlayerPickerCancel = () => {
    setPlayerPickerItemId(null);
    setPlayerPickerError(null);
  };

  const shellWithHeader = (children: ReactNode) => (
    <main className="app-shell">
      <div className="top-bar">
        <Logo scale={2} />
      </div>
      {children}
    </main>
  );

  const myPlayer = room?.players.find((p) => p.id === myId);
  const isObserver = myPlayer?.isObserver ?? false;
  // A Spyglass reveals everyone's time/bids — the server already sends that
  // data once owned, this just decides whether the dock renders it.
  const hasSpyglass = myPlayer?.stash.some((id) => knownItems[id]?.templateId === 'spyglass') ?? false;
  // preBid: the opt-in window (free to enter/cancel); bidding: spending underway.
  const roundPhase: 'preBid' | 'bidding' | null =
    !currentRound || currentRound.round.status !== 'active' ? null : currentRound.round.bidWindowOpen ? 'preBid' : 'bidding';

  const itemPickerTitle = itemPickerMode === 'destroy' ? 'CROSSBOW' : 'MIRROR OF DESIRE';
  const itemPickerSubtitle = itemPickerMode === 'destroy' ? 'Choose an item to destroy.' : 'Choose an item to copy for yourself.';
  const itemPickerExclude = itemPickerMode === 'destroy' ? (room?.players ?? []).filter((p) => isImmune(p.id)).map((p) => p.id) : undefined;

  const playerPickerTitle = playerPickerTemplate?.effectType === 'forceEnter' ? 'DUAL DAGGERS' : 'WOODEN DAGGER';
  const playerPickerSubtitle =
    playerPickerTemplate?.effectType === 'forceEnter' ? 'Choose a player to force into this bid.' : 'Choose a bidder to force out.';
  const scoresByPlayer = useMemo(() => {
    if (!room) return new Map<string, ScoreBreakdown>();
    const wonItems = new Map(Object.entries(knownItems));
    const pricePaidMs = new Map(Object.entries(itemPrices));
    const scores = new Map<string, ScoreBreakdown>();
    for (const score of computeScores(room.players, wonItems, pricePaidMs)) {
      scores.set(score.playerId, score);
    }
    return scores;
  }, [room, knownItems, itemPrices]);

  const fmt = (ms: number) => (Math.max(0, ms) / 1000).toFixed(1) + 's';

  const playerDock = (
    <ul className="player-row">
      {(room?.players ?? []).map((p) => {
        const isMe = p.id === myId;
        // Public "entered this lot" indicator — stays true after a withdrawal.
        const holding = holdingPlayerIds.includes(p.id);
        // Distinct from `holding` above: only true while actively spending, so
        // the live amount swaps for the final spend line the instant you withdraw.
        const isCurrentlyHolding = liveBids[p.id] !== undefined;
        const dropped = (isMe || hasSpyglass) && droppedThisRound[p.id] !== undefined;
        const time = liveTimes[p.id] ?? p.timeRemainingMs;
        const classes = ['player-card', isMe && 'me', holding && 'holding', dropped && 'dropped']
          .filter(Boolean)
          .join(' ');
        return (
          <li key={p.id} className={classes}>
            <button
              type="button"
              className="portrait-button"
              aria-pressed={isMe ? myInventoryOpen : selectedOpponentId === p.id}
              aria-label={isMe ? `${myInventoryOpen ? 'Hide' : 'Show'} your inventory` : `Show ${p.name}'s inventory`}
              onClick={() => {
                if (isMe) setMyInventoryOpen((open) => !open);
                else setSelectedOpponentId((selected) => (selected === p.id ? null : p.id));
              }}
            >
              <PortraitIcon index={p.portraitIndex} />
            </button>
            <div className="name">
              {p.name}
              {isMe ? ' (you)' : p.isBot ? ' (bot)' : ''}
            </div>
            {p.isObserver ? (
              <div>Observing</div>
            ) : isMe || hasSpyglass ? (
              <>
                <div>{fmt(time)} left</div>
                {isCurrentlyHolding && <div>bidding {fmt(liveBids[p.id])}</div>}
                {dropped && <div>withdrew! Spent {fmt(droppedThisRound[p.id])}</div>}
              </>
            ) : holding ? (
              <div>bidding</div>
            ) : null}
          </li>
        );
      })}
    </ul>
  );

  let screen: ReactNode;

  if (!joined) {
    screen = (
      <main className="app-shell">
        <Logo scale={5} />
        <div className="panel">
          <p className="status-line">{connected ? 'Connected to server' : 'Connecting…'}</p>
          {room && room.status !== 'lobby' && (
            <p className="status-line">A game is already in progress. You'll join as an observer.</p>
          )}
          <form onSubmit={handleJoin}>
            <div className="field">
              <label htmlFor="name">Your name</label>
              <input id="name" type="text" value={name} onChange={(e) => setName(e.target.value)} />
            </div>
            <button type="submit" className="btn btn-block" disabled={!connected}>
              JOIN
            </button>
          </form>
          {error && <p className="error-text">{error}</p>}
        </div>
      </main>
    );
  } else if (gameOverPlayers && scores) {
    const ranked = [...scores].sort((a, b) => b.total - a.total);

    screen = shellWithHeader(
      <div className="panel">
        <h2 className="panel-title">GAME OVER</h2>
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
              extras.push(
                `${getTraitDefinition(t.traitId)?.name ?? t.traitId} x${t.count} ${t.multiplier ? `×${t.multiplier}` : `+${t.bonus}`}`
              );
            }

            return (
              <li key={s.playerId} className="results-item">
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
                  {player && <PortraitIcon index={player.portraitIndex} size={40} />}
                  <div>
                    <div className="rank-total">
                      {player?.name}
                      {s.playerId === myId ? ' (you)' : ''}: ${s.total}
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
        <button
          className="btn btn-block"
          style={{ marginTop: '1rem' }}
          onClick={() => {
            playClick();
            socket.emit('restart_game');
          }}
        >
          PLAY AGAIN
        </button>
      </div>
    );
  } else if (!room) {
    screen = shellWithHeader(<p className="status-line">Loading…</p>);
  } else if (room.status === 'game_over') {
    // room.status flipped to game_over before we had a chance to see the
    // one-time game_over event (e.g. joined right as it fired). Nothing to
    // rank, just wait for the next game.
    screen = shellWithHeader(<p className="status-line">A game just ended! Waiting for a new one to start.</p>);
  } else if (room.status === 'lobby') {
    const botCount = room.players.filter((p) => p.isBot).length;
    screen = shellWithHeader(
      <div className="panel">
        <h2 className="panel-title">Lobby</h2>
        <div className="round-limit-control">
          <label htmlFor="round-limit">Rounds: {roundLimit}</label>
          <input
            id="round-limit"
            type="range"
            min="5"
            max="20"
            step="1"
            value={roundLimit}
            onChange={(event) => {
              const maxRounds = Number(event.target.value);
              setRoundLimit(maxRounds);
              socket.emit('set_round_limit', { maxRounds });
            }}
          />
          <div className="round-limit-labels"><span>5</span><span>20</span></div>
        </div>
        <button
          className="btn btn-block"
          onClick={() => {
            playClick();
            socket.emit('start_game');
          }}
        >
          START GAME
        </button>
        <button
          className="btn btn-block"
          style={{ marginTop: '0.75rem' }}
          disabled={botCount >= MAX_BOTS}
          onClick={() => {
            playClick();
            socket.emit('add_bot');
          }}
        >
          Add Bot ({botCount}/{MAX_BOTS})
        </button>
        <button
          className="btn btn-block"
          style={{ marginTop: '0.75rem' }}
          disabled={botCount === 0}
          onClick={() => {
            playClick();
            socket.emit('remove_bot');
          }}
        >
          Remove Bot
        </button>
      </div>
    );
  } else {
    screen = shellWithHeader(
      <Game
        players={room.players}
        myId={myId!}
        myScore={scoresByPlayer.get(myId!)}
        isObserver={isObserver}
        roundNumber={room.currentRoundIndex + 1}
        maxRounds={room.settings.maxRounds}
        currentRound={currentRound}
        liveTimes={liveTimes}
        liveBids={liveBids}
        droppedThisRound={droppedThisRound}
        lastResult={lastResult}
        onHoldStart={() => socket.emit('hold_start')}
        onHoldRelease={() => {
          const isRealWithdraw = currentRound ? !currentRound.round.bidWindowOpen : false;
          if (isRealWithdraw) {
            const otherHolders = Object.keys(liveBids).filter((id) => id !== myId);
            suppressNextLoseRef.current = otherHolders.length === 0;
          }
          socket.emit('hold_release');
        }}
      />
    );
  }

  return (
    <>
      {screen}
      {joined && myPlayer && myInventoryOpen && (
        <Inventory
          player={myPlayer}
          items={knownItems}
          score={scoresByPlayer.get(myPlayer.id)}
          side="left"
          onClose={() => setMyInventoryOpen(false)}
          onUseItem={handleUseItem}
          roundPhase={roundPhase}
        />
      )}
      {joined && itemPickerItemId && room && (
        <ItemTargetPicker
          title={itemPickerTitle}
          subtitle={itemPickerSubtitle}
          players={room.players}
          myId={myId!}
          items={knownItems}
          excludePlayerIds={itemPickerExclude}
          error={itemPickerError}
          onSelect={handleItemPickerSelect}
          onCancel={handleItemPickerCancel}
        />
      )}
      {joined && playerPickerItemId && (
        <PlayerPicker
          title={playerPickerTitle}
          subtitle={playerPickerSubtitle}
          players={playerPickerCandidates}
          error={playerPickerError}
          onSelect={handlePlayerPickerSelect}
          onCancel={handlePlayerPickerCancel}
        />
      )}
      {actionError && <div className="action-error-banner">{actionError}</div>}
      {joined && selectedOpponentId && room?.players.find((player) => player.id === selectedOpponentId) && (
        <Inventory
          player={room.players.find((player) => player.id === selectedOpponentId)!}
          items={knownItems}
          score={scoresByPlayer.get(selectedOpponentId)}
          side="right"
          showValue={false}
          onClose={() => setSelectedOpponentId(null)}
        />
      )}
      <BackgroundMusic ducked={currentRound !== null} muffled={!joined || room?.status === 'lobby'} />
      <button className="dev-reset-button" onClick={handleResetGame}>
        Reset Game
      </button>
      <div className="bottom-bar">
        {playerDock}
        <Chat messages={chatMessages} onSend={(text) => socket.emit('send_chat', { name: name || 'Guest', text })} />
      </div>
    </>
  );
}
