import { useEffect, useMemo, useRef, useState } from 'react';
import type { FormEvent, ReactNode } from 'react';
import type { ChatMessage, ItemInstance, JoinFailureReason, MaskedRoundItem, Player, Round, RoomState, ScoreBreakdown } from 'shared';
import {
  MAX_PLAYERS_PER_ROOM,
  ROOM_CODE_ALPHABET,
  ROOM_CODE_LENGTH,
  computeScores,
  getClassDefinition,
  getTemplate,
  getTraitDefinition,
  normalizeRoomCode,
  rankScores,
} from 'shared';
import { socket } from './socket';
import { buildInviteLink, clearLobbyCodeFromUrl, readLobbyCodeFromUrl, writeLobbyCodeToUrl } from './lobbyLink';
import { Logo } from './Logo';
import { Game } from './Game';
import { Lobby } from './Lobby';
import { PortraitIcon } from './PortraitIcon';
import { Chat } from './Chat';
import { BackgroundMusic } from './BackgroundMusic';
import { Inventory } from './Inventory';
import { ItemTargetPicker } from './ItemTargetPicker';
import { PlayerPicker } from './PlayerPicker';
import { LotPool } from './LotPool';
import { playChatDing, playClick, playLose, playWin } from './sound';
import { useViewportTooltips } from './useViewportTooltips';

// Applied on every keystroke so a pasted '#QT4B' or a lowercase code becomes
// canonical as it lands, rather than only at submit. Length is capped by the
// input's maxLength, not here, so backspacing over a long paste still works.
function sanitizeCodeInput(raw: string): string {
  return raw
    .toUpperCase()
    .replace(/^[#/]+/, '')
    .split('')
    .filter((c) => ROOM_CODE_ALPHABET.includes(c))
    .join('');
}

interface CurrentRound {
  round: Round;
  item: MaskedRoundItem;
}

interface LastResult {
  round: Round;
  item: ItemInstance;
}

export default function App() {
  useViewportTooltips();

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

  // Raw text of the lobby-code field, seeded once from the URL so an invite
  // link prefills it. Read lazily so nothing re-reads the hash later — after
  // joining, the hash is write-only. Kept raw rather than normalized so a
  // half-typed code doesn't fight the user mid-keystroke.
  const [codeInput, setCodeInput] = useState(() => readLobbyCodeFromUrl() ?? '');
  const [lobbyCode, setLobbyCode] = useState<string | null>(null);
  const [joining, setJoining] = useState(false);
  const [joinErrorReason, setJoinErrorReason] = useState<JoinFailureReason | null>(null);
  // null means "no code entered" — join_room reads that as "create a new lobby".
  const pendingLobbyCode = normalizeRoomCode(codeInput);
  const codeLooksWrong = codeInput.length > 0 && pendingLobbyCode === null;

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
  // Any number of opponent inventories can be open at once; order is open order,
  // which also drives the cascade offset of their panels.
  const [openOpponentIds, setOpenOpponentIds] = useState<string[]>([]);
  const [myInventoryOpen, setMyInventoryOpen] = useState(true);
  const [roundLimit, setRoundLimit] = useState(15);
  // Mirror of Desire (copy) and Crossbow (destroy) both target an item in
  // someone else's inventory — one picker overlay serves both.
  const [itemPickerItemId, setItemPickerItemId] = useState<string | null>(null);
  const [itemPickerError, setItemPickerError] = useState<string | null>(null);
  // Dual Daggers and Wooden Dagger target a player directly.
  const [playerPickerItemId, setPlayerPickerItemId] = useState<string | null>(null);
  const [playerPickerError, setPlayerPickerError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [lotPoolOpen, setLotPoolOpen] = useState(false);

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
      // Belt-and-braces against a raced ack or a hash the user wiped.
      // replaceState to an identical URL is a no-op, so this is cheap.
      if (state.code) {
        setLobbyCode(state.code);
        writeLobbyCodeToUrl(state.code);
      }
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
        setLiveTimes({});
        setLiveBids({});
        setHoldingPlayerIds([]);
        setDroppedThisRound({});
        setSelectedOpponentId(null);
        setItemPickerItemId(null);
        setItemPickerError(null);
        setPlayerPickerItemId(null);
        setPlayerPickerError(null);
        setActionError(null);
        setLotPoolOpen(false);
      }
      setOpenOpponentIds((open) => {
        const present = open.filter((id) => state.players.some((player) => player.id === id));
        return present.length === open.length ? open : present;
      });
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
    setJoinErrorReason(null);
    setJoining(true);
    socket.emit('join_room', { playerName: name, code: pendingLobbyCode }, (res) => {
      if (res.ok) {
        setMyId(res.playerId);
        setRoom(res.state);
        setLobbyCode(res.code);
        writeLobbyCodeToUrl(res.code);
        setJoined(true);
        return;
      }

      setJoining(false);
      setJoinErrorReason(res.reason);
      setError(res.error);
      // A dead code shouldn't linger — retrying then just creates a fresh lobby.
      if (res.reason === 'not_found' || res.reason === 'invalid_code') {
        setCodeInput('');
        clearLobbyCodeFromUrl();
      }
    });
  };

  // Bails out of a full lobby into a brand-new one of your own.
  const handleStartOwnLobby = () => {
    playClick();
    setCodeInput('');
    clearLobbyCodeFromUrl();
    setError(null);
    setJoinErrorReason(null);
  };

  const handleResetGame = () => {
    playClick();
    if (window.confirm('Reset this lobby for everyone? This clears all progress.')) {
      socket.emit('reset_game');
    }
  };

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
      return room.players.filter((p) => p.id !== myId && bidders[p.id] && bidders[p.id].droppedAt === null);
    }
    if (playerPickerTemplate.effectType === 'forceWithdraw') {
      return room.players.filter((p) => p.id !== myId && liveBids[p.id] !== undefined);
    }
    if (playerPickerTemplate.effectType === 'stealTime') {
      return room.players.filter((p) => p.id !== myId && !p.isObserver && p.status === 'active');
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
  // Derived, never mirrored into state: host migration then costs zero client
  // logic — the server rebroadcasts room_state and the controls simply move.
  const hostId = room?.hostId ?? null;
  const isHost = !!myId && hostId === myId;
  const hostName = room?.players.find((p) => p.id === hostId)?.name ?? null;
  const inviteLink = useMemo(() => (lobbyCode ? buildInviteLink(lobbyCode) : null), [lobbyCode]);
  // A Spyglass reveals everyone's time/bids — the server already sends that
  // data once owned, this just decides whether the dock renders it.
  const hasSpyglass = myPlayer?.stash.some((id) => knownItems[id]?.templateId === 'spyglass') ?? false;
  // preBid: the opt-in window (free to enter/cancel); bidding: spending underway.
  const roundPhase: 'preBid' | 'bidding' | null =
    !currentRound || currentRound.round.status !== 'active' ? null : currentRound.round.bidWindowOpen ? 'preBid' : 'bidding';

  const itemPickerTitle = itemPickerMode === 'destroy' ? 'CROSSBOW' : 'MIRROR OF DESIRE';
  const itemPickerSubtitle = itemPickerMode === 'destroy' ? 'Choose an item to destroy.' : 'Choose an item to copy for yourself.';
  const playerPickerTitle =
    playerPickerTemplate?.effectType === 'forceEnter'
      ? 'DUAL DAGGERS'
      : playerPickerTemplate?.effectType === 'stealTime'
        ? "DARK KNIGHT'S GREATAXE"
        : 'WOODEN DAGGER';
  const playerPickerSubtitle =
    playerPickerTemplate?.effectType === 'forceEnter'
      ? 'Choose a player to force into this bid.'
      : playerPickerTemplate?.effectType === 'stealTime'
        ? 'Choose a player to steal up to 5 seconds from.'
        : 'Choose a bidder to force out.';
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
        const classDef = getClassDefinition(p.classId);
        const classes = ['player-card', isMe && 'me', holding && 'holding', dropped && 'dropped']
          .filter(Boolean)
          .join(' ');
        return (
          <li key={p.id} className={classes}>
            <button
              type="button"
              className="portrait-button"
              aria-pressed={isMe ? myInventoryOpen : openOpponentIds.includes(p.id)}
              aria-label={
                isMe
                  ? `${myInventoryOpen ? 'Hide' : 'Show'} your inventory`
                  : `${openOpponentIds.includes(p.id) ? 'Hide' : 'Show'} ${p.name}'s inventory`
              }
              onClick={() => {
                if (isMe) setMyInventoryOpen((open) => !open);
                else setOpenOpponentIds((open) => (open.includes(p.id) ? open.filter((id) => id !== p.id) : [...open, p.id]));
              }}
            >
              <PortraitIcon index={p.portraitIndex} size={64} />
            </button>
            {classDef && (
              <div className="player-class-badge" style={{ color: classDef.color, borderColor: classDef.color }} tabIndex={0}>
                {classDef.name}
                {classDef.id === 'gambler' && p.winStreak > 0 ? ` (${p.winStreak})` : ''}
                <div className="inventory-tooltip player-class-tooltip">
                  <b style={{ color: classDef.color }}>{classDef.name.toUpperCase()}</b>
                  <span>{classDef.description}</span>
                </div>
              </div>
            )}
            {p.id === hostId && <div className="host-badge">HOST</div>}
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
          <form onSubmit={handleJoin}>
            <div className="field">
              <label htmlFor="name">Your name</label>
              <input id="name" type="text" value={name} onChange={(e) => setName(e.target.value)} />
            </div>
            <div className="field">
              <label htmlFor="lobby-code">Lobby code (optional)</label>
              <input
                id="lobby-code"
                type="text"
                className="lobby-code-input"
                value={codeInput}
                onChange={(e) => setCodeInput(sanitizeCodeInput(e.target.value))}
                // 4 *or* 5: generateCode widens to 5 characters on collision.
                maxLength={ROOM_CODE_LENGTH + 1}
                autoCapitalize="characters"
                autoCorrect="off"
                spellCheck={false}
                placeholder="TIME"
              />
              <p className="field-hint">Leave blank to start a new lobby.</p>
            </div>
            <button
              type="submit"
              className="btn btn-block"
              disabled={!connected || joining || !name.trim() || codeLooksWrong}
            >
              {joining ? 'JOINING…' : pendingLobbyCode ? 'JOIN LOBBY' : 'CREATE LOBBY'}
            </button>
          </form>
          {codeLooksWrong && (
            <p className="error-text">Lobby codes are {ROOM_CODE_LENGTH} characters, letters and numbers.</p>
          )}
          {error && <p className="error-text">{error}</p>}
          {joinErrorReason === 'room_full' && (
            <button className="btn btn-block" style={{ marginTop: '0.75rem' }} onClick={handleStartOwnLobby}>
              START A NEW LOBBY INSTEAD
            </button>
          )}
        </div>
      </main>
    );
  } else if (gameOverPlayers && scores) {
    const ranked = rankScores(scores, gameOverPlayers);

    screen = shellWithHeader(
      <div className="panel">
        <h2 className="panel-title">GAME OVER</h2>
        <ol className="results-list">
          {ranked.map(({ score: s, rank, shared }) => {
            const player = gameOverPlayers.find((p) => p.id === s.playerId);
            const itemNames = (player?.stash ?? [])
              .map((id) => knownItems[id])
              .filter((item): item is ItemInstance => Boolean(item))
              .map((item) => getTemplate(item.templateId)?.name ?? item.templateId);

            const extras: string[] = [];
            if (s.hiddenTraitBonus !== 0) extras.push(`hidden ${s.hiddenTraitBonus >= 0 ? '+' : ''}${s.hiddenTraitBonus}`);
            if (s.scoreScalingBonus !== 0) extras.push(`scaling +${s.scoreScalingBonus}`);
            if (s.solitaireBonus !== 0) extras.push(`solitaire +${s.solitaireBonus}`);
            if (s.hoarderBonus !== 0) extras.push(`hoarder +${s.hoarderBonus}`);
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
                      {shared ? `T${rank}` : `#${rank}`} {player?.name}
                      {s.playerId === myId ? ' (you)' : ''}: ${s.total}
                      {shared && <span className="tied-label"> (tied)</span>}
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
        {isHost ? (
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
        ) : (
          <p className="status-line" style={{ marginTop: '1rem' }}>
            Waiting for {hostName ?? 'the host'} to start another game…
          </p>
        )}
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
    screen = shellWithHeader(
      <Lobby
        lobbyCode={lobbyCode ?? room.code}
        inviteLink={inviteLink}
        isHost={isHost}
        hostName={hostName}
        playerCount={room.players.length}
        maxPlayers={MAX_PLAYERS_PER_ROOM}
        botCount={room.players.filter((p) => p.isBot).length}
        roundLimit={roundLimit}
        onRoundLimitChange={(maxRounds) => {
          setRoundLimit(maxRounds);
          socket.emit('set_round_limit', { maxRounds });
        }}
        onStartGame={() => socket.emit('start_game')}
        onAddBot={() => socket.emit('add_bot')}
        onRemoveBot={() => socket.emit('remove_bot')}
      />
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
        onOpenLotPool={() => setLotPoolOpen(true)}
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
      {joined && lotPoolOpen && room && <LotPool pool={room.lotPool} onClose={() => setLotPoolOpen(false)} />}
      {joined &&
        openOpponentIds.map((opponentId, index) => {
          const opponent = room?.players.find((player) => player.id === opponentId);
          if (!opponent) return null;
          return (
            <Inventory
              key={opponentId}
              player={opponent}
              items={knownItems}
              score={scoresByPlayer.get(opponentId)}
              side="right"
              showValue={false}
              panelKey={`inventory-opponent-${opponentId}`}
              cascadeIndex={index}
              onClose={() => setOpenOpponentIds((open) => open.filter((id) => id !== opponentId))}
            />
          );
        })}
      <BackgroundMusic ducked={currentRound !== null} muffled={!joined || room?.status === 'lobby'} />
      {isHost && (
        <button className="dev-reset-button" onClick={handleResetGame}>
          Reset Game
        </button>
      )}
      <div className="bottom-bar">
        {playerDock}
        <Chat messages={chatMessages} onSend={(text) => socket.emit('send_chat', { name: name || 'Guest', text })} />
      </div>
    </>
  );
}
