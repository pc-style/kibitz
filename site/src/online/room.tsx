import type { Key } from '@lichess-org/chessground/types';
import { Chess } from 'chess.js';
import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import { IDLE_MS, timeControl } from '../../convex/timeControls';
import { destsOf, playUci } from '../learn/play';
import { useSettings } from '../settings';
import { reviewHash } from '../sources';
import { Board, type Movable } from '../ui/board';
import { TopNav } from '../ui/nav';
import { Piece } from '../ui/piece';
import { isPromotion, PromotionPicker } from '../ui/promotion';
import { errorText, rooms, serverNow, syncServerTime, useConnected, useRoom, type RoomView } from './client';
import { player, roomLink, setPlayerName } from './player';
import { TimeChoices } from './setup';
import '../play/play.css';
import './online.css';

type Color = 'white' | 'black';
const other = (c: Color): Color => (c === 'white' ? 'black' : 'white');
const SIDE = { white: 'White', black: 'Black' };

function replay(moves: string[]): Chess {
  const chess = new Chess();
  for (const m of moves) playUci(chess, m);
  return chess;
}

const clockLabel = (id: string) => {
  const t = timeControl(id);
  return !t || t.id === 'none' ? 'No clock' : `${t.id} ${t.label}`;
};

/** A game against a friend at #/play/<code>. Everything shown comes live from the server. */
export function RoomPage({ code }: { code: string }) {
  const me = player();
  const { room, error } = useRoom(code, me.token);
  const connected = useConnected();
  useEffect(() => {
    void syncServerTime();
    const back = () => document.visibilityState === 'visible' && void syncServerTime(true);
    document.addEventListener('visibilitychange', back);
    return () => document.removeEventListener('visibilitychange', back);
  }, []);

  if (room === undefined) {
    return (
      <Shell>
        <p class="online-note" role="status">
          {error ?? 'Opening the room…'}
        </p>
      </Shell>
    );
  }
  if (room === null || room.status === 'closed') {
    return (
      <Shell>
        <section class="online-gone">
          <h1>{room ? 'This room has closed.' : 'This room doesn’t exist.'}</h1>
          <p>{room ? 'Rooms close after 15 minutes without a move.' : 'The link may be mistyped, or the room closed a while ago.'} Start a new one and send your friend the link.</p>
          <a class="button button-primary" href="#/play?with=friend">
            New game with a friend
          </a>
        </section>
      </Shell>
    );
  }
  return <Room room={room} code={code} connected={connected} />;
}

function Shell({ children }: { children: preact.ComponentChildren }) {
  return (
    <main class="play-page online-page">
      <TopNav current="play" />
      {children}
    </main>
  );
}

function Room({ room, code, connected }: { room: RoomView; code: string; connected: boolean }) {
  const me = player();
  const settings = useSettings();
  const you = room.you;
  const seated = !!you;
  const [orientation, setOrientation] = useState<Color>(you ?? 'white');
  // A move sent but not yet confirmed, with your clock as it stood when you let go of the piece.
  const [pending, setPending] = useState<{ ply: number; uci: string; clockMs: number } | null>(null);
  const [picking, setPromoting] = useState<{ from: Key; to: Key; ply: number } | null>(null);
  const [confirm, setConfirm] = useState(false);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string>();
  const list = useRef<HTMLOListElement>(null);

  // A rematch swaps colors; turn the board to your new side.
  useEffect(() => {
    if (you) setOrientation(you);
  }, [you, room.game]);

  // The server's next update supersedes a move we drew early, including a game that ended on time instead.
  useEffect(() => setPending(null), [room.moves.length, room.game, room.status]);
  useEffect(() => {
    setPromoting(null);
    setConfirm(false);
  }, [room.game, room.status]);

  // Keeps your online dot lit while this tab is open.
  useEffect(() => {
    if (!seated) return;
    const beat = () => document.visibilityState === 'visible' && rooms.heartbeat({ code, token: me.token }).catch(() => {});
    beat();
    const timer = setInterval(beat, 15_000);
    document.addEventListener('visibilitychange', beat);
    return () => {
      clearInterval(timer);
      document.removeEventListener('visibilitychange', beat);
    };
  }, [seated, code]);

  const moves = pending && pending.ply === room.moves.length ? [...room.moves, pending.uci] : room.moves;
  // A promotion choice belongs to the position it was made in; a move from another tab retires it.
  const promoting = picking && picking.ply === room.moves.length && !pending ? picking : null;
  const chess = useMemo(() => replay(moves), [moves.join(' ')]);
  const history = chess.history({ verbose: true });
  const last = history.at(-1);
  const turn: Color = chess.turn() === 'w' ? 'white' : 'black';
  const playing = room.status === 'playing';
  const myTurn = playing && you === turn && !pending;

  const act = async (run: () => Promise<unknown>) => {
    setBusy(true);
    setProblem(undefined);
    try {
      await run();
    } catch (err) {
      setProblem(errorText(err));
    } finally {
      setBusy(false);
    }
  };
  const args = { code, token: me.token };

  const send = (from: Key, to: Key, promotion = 'q') => {
    setPromoting(null);
    const probe = replay(room.moves);
    const m = playUci(probe, from + to + promotion);
    if (!m || !myTurn) return;
    const ply = room.moves.length;
    setPending({ ply, uci: m.lan, clockMs: clockAt(room, you!, serverNow()) });
    setProblem(undefined);
    // By the time a Convex mutation resolves, the room update it caused has arrived, so the early copy can go.
    rooms.move({ ...args, uci: m.lan, ply }).then(
      () => setPending(null),
      (err) => {
        setPending(null);
        setProblem(errorText(err));
      },
    );
  };

  const movable = useMemo<Movable | undefined>(
    () =>
      !myTurn || promoting || !you
        ? undefined
        : {
            color: you,
            dests: destsOf(chess),
            onMove: (from, to) => (isPromotion(chess.fen(), from, to) ? setPromoting({ from, to, ply: room.moves.length }) : send(from, to)),
          },
    [myTurn, promoting, chess, you],
  );
  const shownFen = useMemo(() => {
    if (!promoting) return chess.fen();
    const probe = new Chess(chess.fen());
    return playUci(probe, promoting.from + promoting.to + 'q') ? probe.fen() : chess.fen();
  }, [promoting, chess]);

  useEffect(() => {
    if (list.current) list.current.scrollTop = list.current.scrollHeight;
  }, [moves.length]);

  const names = { white: room.white?.name ?? 'Waiting…', black: room.black?.name ?? 'Waiting…' };
  const opponent = you ? other(you) : null;
  const status = describe(room, you, names, turn);

  return (
    <Shell>
      <section class="play-stage" aria-label="Game board">
        <PlayerRow room={room} color={other(orientation)} you={you} frozenMs={pending?.clockMs} />
        <div class="board play-board">
          <Board
            fen={shownFen}
            orientation={orientation}
            lastMove={last ? [last.from as Key, last.to as Key] : undefined}
            shapes={[]}
            movable={movable}
            coordinates={settings.coordinates}
            animate={settings.motion}
          />
          {promoting && you ? (
            <PromotionPicker square={promoting.to} color={you} orientation={orientation} onPick={(p) => send(promoting.from, promoting.to, p)} onCancel={() => setPromoting(null)} />
          ) : null}
        </div>
        <PlayerRow room={room} color={orientation} you={you} frozenMs={pending?.clockMs} />
      </section>

      <section class="play-panel" aria-label="Game">
        <header class="play-heading">
          <h1>{room.status === 'waiting' ? (you ? 'Waiting for your friend' : 'You’re invited') : you ? `You vs ${names[opponent!]}` : `${names.white} vs ${names.black}`}</h1>
          <p>
            {clockLabel(room.clock)}
            {room.game > 1 ? ` · game ${room.game}` : ''}
            {you || room.status === 'waiting' ? '' : ' · watching'}
          </p>
        </header>

        {!connected ? (
          <p class="online-offline" role="status">
            Reconnecting to the game server…
          </p>
        ) : null}

        {!you && room.status === 'waiting' ? (
          <JoinCard room={room} code={code} />
        ) : (
          <>
            {room.status === 'waiting' ? <Invite code={code} /> : null}
            <div class="play-status" role="status" data-ending={room.status === 'over' ? '' : undefined}>
              <h2 key={status.title}>{status.title}</h2>
              {status.detail ? <p key={status.detail}>{status.detail}</p> : null}
            </div>
          </>
        )}

        {you && playing && room.drawOffer === opponent ? (
          <div class="play-actions online-offer">
            <button class="button button-primary" type="button" disabled={busy} onClick={() => act(() => rooms.offerDraw(args))}>
              Accept draw
            </button>
            <button class="button" type="button" disabled={busy} onClick={() => act(() => rooms.declineDraw(args))}>
              Decline
            </button>
          </div>
        ) : null}

        {you && room.status === 'over' ? (
          <div class="play-actions play-end">
            <button class="button button-primary" type="button" disabled={busy || room.rematch === you} onClick={() => act(() => rooms.rematch(args))}>
              {room.rematch === opponent ? 'Accept rematch' : room.rematch === you ? 'Rematch asked' : 'Rematch'}
            </button>
            {room.moves.length ? (
              <a class="button" href={reviewHash(gamePgn(room, names), you === 'black' ? 'b' : 'w')}>
                Review this game
              </a>
            ) : null}
            <a class="button" href="#/play?with=friend">
              New room
            </a>
          </div>
        ) : null}

        {you && playing ? (
          confirm ? (
            <div class="play-confirm" role="group" aria-label="Confirm resignation">
              <p>Resign this game?</p>
              <div class="play-actions">
                <button class="button" type="button" onClick={() => setConfirm(false)}>
                  Keep playing
                </button>
                <button
                  class="button"
                  type="button"
                  disabled={busy}
                  onClick={() => {
                    setConfirm(false);
                    act(() => rooms.resign(args));
                  }}
                >
                  Yes, resign
                </button>
              </div>
            </div>
          ) : (
            <div class="play-actions">
              {room.moves.length < 2 ? (
                <button class="button" type="button" disabled={busy} onClick={() => act(() => rooms.abort(args))}>
                  Abort
                </button>
              ) : (
                <button class="button" type="button" disabled={busy || room.drawOffer === you} onClick={() => act(() => rooms.offerDraw(args))}>
                  {room.drawOffer === you ? 'Draw offered' : 'Offer draw'}
                </button>
              )}
              <button class="button" type="button" disabled={busy} onClick={() => setConfirm(true)}>
                Resign
              </button>
              <button class="button" type="button" onClick={() => setOrientation(other(orientation))}>
                Flip board
              </button>
            </div>
          )
        ) : null}

        {problem ? (
          <p class="form-error" role="alert">
            {problem}
          </p>
        ) : null}

        {you && room.status !== 'over' && room.moves.length === 0 ? <ClockPicker room={room} code={code} /> : null}

        {room.status === 'waiting' ? null : (
        <div class="play-scoresheet">
          <h2>Moves</h2>
          {history.length ? (
            <ol ref={list} class="play-moves" aria-label="Moves">
              {history
                .filter((_, i) => i % 2 === 0)
                .map((m, i) => (
                  <li key={i}>
                    <span>{i + 1}.</span>
                    <span class="play-san">{m.san}</span>
                    <span class={history[i * 2 + 1] ? 'play-san' : ''}>{history[i * 2 + 1]?.san ?? ''}</span>
                  </li>
                ))}
            </ol>
          ) : (
            <p class="play-note">White moves first.</p>
          )}
        </div>
        )}

        <div class="online-foot">
          {you ? <NameField room={room} code={code} you={you} /> : null}
          {room.status !== 'waiting' ? <Invite code={code} compact /> : null}
          <IdleNote room={room} />
        </div>
      </section>
    </Shell>
  );
}

/** What's happening, in one heading and one line. */
function describe(room: RoomView, you: Color | null, names: Record<Color, string>, turn: Color): { title: string; detail?: string } {
  const who = (c: Color) => (c === you ? 'You' : names[c]);
  if (room.status === 'waiting') return { title: 'Send this link to a friend.', detail: 'The game starts when they open it. You can change the time until the first move.' };
  if (room.status === 'over') return ending(room, you, names);
  const yours = turn === you;
  const title = yours ? 'Your move.' : `${names[turn]} to move.`;
  if (room.drawOffer && room.drawOffer !== you) return { title: `${who(room.drawOffer)} offered a draw.`, detail: yours ? 'Accept it, decline it, or just play on.' : undefined };
  if (room.moves.length < 2 && room.clock !== 'none') return { title, detail: 'The clocks start once each side has moved.' };
  if (replay(room.moves).inCheck()) return { title, detail: yours ? 'You are in check.' : `${names[turn]} is in check.` };
  return { title };
}

function ending(room: RoomView, you: Color | null, names: Record<Color, string>): { title: string; detail?: string } {
  const winner: Color | null = room.result === '1-0' ? 'white' : room.result === '0-1' ? 'black' : null;
  const loser = winner ? other(winner) : null;
  const won = winner && (winner === you ? 'You won' : `${names[winner]} won`);
  const rematch = room.rematch && room.rematch !== you ? `${room.rematch === you ? 'You' : names[room.rematch]} wants a rematch.` : room.rematch === you ? `Rematch asked. Waiting for ${names[other(you!)]}.` : undefined;
  const titled = (title: string, detail?: string) => ({ title, detail: rematch ?? detail });
  switch (room.reason) {
    case 'checkmate':
      return titled(`Checkmate. ${won}.`);
    case 'resignation':
      return titled(`${loser === you ? 'You' : names[loser!]} resigned. ${won}.`);
    case 'timeout':
      return titled(`${won} on time.`, `${loser === you ? 'Your' : `${names[loser!]}'s`} clock ran out.`);
    case 'timeout-draw':
      return titled('Draw.', 'A clock ran out, but the other side had too little left to checkmate.');
    case 'stalemate':
      return titled('Stalemate. A draw.');
    case 'insufficient':
      return titled('A draw.', 'Neither side has enough pieces left to checkmate.');
    case 'repetition':
      return titled('Draw by repetition.', 'The same position came up three times.');
    case 'fifty':
      return titled('A draw.', 'Fifty moves went by with no capture and no pawn move.');
    case 'agreement':
      return titled('Draw agreed.');
    case 'aborted':
      return titled('Game aborted.', 'No result. Ask for a rematch to start again.');
    default:
      return titled('Game over.');
  }
}

/** Time on `color`'s clock at server time `now`, never more than the server granted. */
function clockAt(room: RoomView, color: Color, now: number): number {
  const base = color === 'white' ? room.whiteMs : room.blackMs;
  const turn: Color = room.moves.length % 2 === 0 ? 'white' : 'black';
  const running = room.status === 'playing' && room.clock !== 'none' && room.moves.length >= 2 && turn === color;
  return running ? Math.min(base, Math.max(0, base - (now - room.turnStartedAt))) : base;
}

/**
 * A player's name, presence and clock. Clocks follow the server's turn: while your move is on its way,
 * your clock holds where you stopped it and the opponent's waits until the server starts it.
 */
function PlayerRow({ room, color, you, frozenMs }: { room: RoomView; color: Color; you: Color | null; frozenMs?: number }) {
  const seat = room[color];
  const [now, setNow] = useState(serverNow);
  const turn: Color = room.moves.length % 2 === 0 ? 'white' : 'black';
  const frozen = frozenMs !== undefined && color === you;
  const running = !frozen && room.status === 'playing' && room.clock !== 'none' && room.moves.length >= 2 && turn === color;
  useEffect(() => {
    const timer = setInterval(() => setNow(serverNow()), running ? 100 : 5000);
    return () => clearInterval(timer);
  }, [running]);
  const online = !!seat && now - seat.seenAt < 45_000;
  const ms = frozen ? frozenMs : clockAt(room, color, now);
  return (
    <div class="play-player online-player" data-active={room.status === 'playing' && turn === color ? '' : undefined}>
      <Piece role={color === you ? 'king' : 'pawn'} color={color} />
      <strong>{seat ? seat.name : 'Waiting for a friend…'}</strong>
      {color === you ? <span class="online-tag">you</span> : seat && !online ? <span class="online-tag online-away">away</span> : null}
      {room.clock === 'none' ? (
        <span>{SIDE[color]}</span>
      ) : (
        <span class={`online-clock ${running ? 'online-clock-running' : ''} ${ms < 20_000 ? 'online-clock-low' : ''}`} role="timer" aria-label={`${SIDE[color]} clock`}>
          {formatClock(ms)}
        </span>
      )}
    </div>
  );
}

function formatClock(ms: number): string {
  const s = Math.ceil(ms / 1000);
  if (ms < 10_000) return `0:${(ms / 1000).toFixed(1).padStart(4, '0')}`;
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

/** The friend's first visit: pick a name and take the free seat. */
function JoinCard({ room, code }: { room: RoomView; code: string }) {
  const me = player();
  const [name, setName] = useState(me.name);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string>();
  const host: Color = room.white ? 'white' : 'black';
  const join = async (e: Event) => {
    e.preventDefault();
    setBusy(true);
    setProblem(undefined);
    setPlayerName(name);
    try {
      await rooms.join({ code, token: me.token, name });
    } catch (err) {
      setProblem(errorText(err));
      setBusy(false);
    }
  };
  return (
    <form class="online-join" onSubmit={join}>
      <h2>{room[host]!.name} invited you to a game.</h2>
      <p>
        You play {SIDE[other(host)]} · {clockLabel(room.clock)}
      </p>
      <label class="field">
        <span>Your name</span>
        <input value={name} maxLength={20} onInput={(e) => setName(e.currentTarget.value)} placeholder="Player" autocomplete="nickname" spellcheck={false} />
      </label>
      <button class="button button-primary" type="submit" disabled={busy}>
        {busy ? 'Joining…' : 'Join the game'}
      </button>
      {problem ? (
        <p class="form-error" role="alert">
          {problem}
        </p>
      ) : null}
    </form>
  );
}

function Invite({ code, compact }: { code: string; compact?: boolean }) {
  const link = roomLink(code);
  const [copied, setCopied] = useState<boolean | null>(null);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(link);
      setCopied(true);
    } catch {
      setCopied(false);
    }
    setTimeout(() => setCopied(null), 2000);
  };
  const share = () => navigator.share({ title: 'Play chess with me on Kibitz', url: link }).catch(() => {});
  return (
    <div class={`online-invite ${compact ? 'online-invite-compact' : ''}`}>
      <label class="field">
        <span>{compact ? 'Room link' : 'Invite link'}</span>
        <input value={link} readOnly onFocus={(e) => e.currentTarget.select()} />
      </label>
      <div class="play-actions">
        <button class={`button ${compact ? '' : 'button-primary'}`} type="button" onClick={copy}>
          {copied === true ? 'Copied' : copied === false ? 'Copy failed' : 'Copy link'}
        </button>
        {!compact && 'share' in navigator ? (
          <button class="button" type="button" onClick={share}>
            Share…
          </button>
        ) : null}
      </div>
    </div>
  );
}

function NameField({ room, code, you }: { room: RoomView; code: string; you: Color }) {
  const saved = room[you]!.name;
  const [name, setName] = useState(saved);
  const [problem, setProblem] = useState<string>();
  useEffect(() => setName(saved), [saved]);
  const save = async (e?: Event) => {
    e?.preventDefault();
    if (name.trim() === saved) return;
    setPlayerName(name);
    try {
      await rooms.setName({ code, token: player().token, name });
      setProblem(undefined);
    } catch (err) {
      setProblem(errorText(err));
    }
  };
  return (
    <form class="online-name" onSubmit={save}>
      <label class="field">
        <span>Your name</span>
        <input value={name} maxLength={20} onInput={(e) => setName(e.currentTarget.value)} onBlur={() => save()} autocomplete="nickname" spellcheck={false} />
      </label>
      {problem ? <p class="form-error">{problem}</p> : null}
    </form>
  );
}

/** Before the first move either player can change the time mode; both see it change. */
function ClockPicker({ room, code }: { room: RoomView; code: string }) {
  const [problem, setProblem] = useState<string>();
  const pick = (clock: string) =>
    rooms.setClock({ code, token: player().token, clock }).then(
      () => setProblem(undefined),
      (err) => setProblem(errorText(err)),
    );
  return (
    <fieldset class="online-clocks">
      <legend>Time</legend>
      <TimeChoices value={room.clock} onPick={pick} name={`clock-${code}`} />
      {problem ? <p class="form-error">{problem}</p> : null}
    </fieldset>
  );
}

/** Rooms close 15 minutes after the last action; say so, and count down near the end. */
function IdleNote({ room }: { room: RoomView }) {
  const [now, setNow] = useState(serverNow);
  useEffect(() => {
    const timer = setInterval(() => setNow(serverNow()), 1000);
    return () => clearInterval(timer);
  }, []);
  const left = room.lastActivity + IDLE_MS - now;
  if (left > 5 * 60_000) return <p class="play-note">Rooms close after 15 minutes with no moves or other actions.</p>;
  const m = Math.max(0, Math.floor(left / 60_000));
  const s = Math.max(0, Math.floor((left % 60_000) / 1000));
  const keep = room.status === 'waiting' ? 'if nobody joins' : room.status === 'over' ? 'unless someone asks for a rematch' : 'unless someone moves';
  return (
    <p class="play-note online-idle">
      This room closes in {m}:{String(s).padStart(2, '0')} {keep}.
    </p>
  );
}

function gamePgn(room: RoomView, names: Record<Color, string>): string {
  const chess = replay(room.moves);
  chess.setHeader('Event', 'Kibitz game with a friend');
  chess.setHeader('Date', new Date().toISOString().slice(0, 10).replaceAll('-', '.'));
  chess.setHeader('White', names.white);
  chess.setHeader('Black', names.black);
  chess.setHeader('Result', room.result && room.result !== '*' ? room.result : '*');
  if (room.clock !== 'none') {
    const t = timeControl(room.clock)!;
    chess.setHeader('TimeControl', `${t.minutes * 60}+${t.increment}`);
  }
  return chess.pgn();
}
