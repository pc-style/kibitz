import type { Key } from '@lichess-org/chessground/types';
import { Chess } from 'chess.js';
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'preact/hooks';
import { LiveEngine } from '../engine';
import { arrowShape, destsOf, playUci } from '../learn/play';
import { useSettings } from '../settings';
import { reviewHash } from '../sources';
import { Board, type Movable } from '../ui/board';
import { Piece } from '../ui/piece';
import { isPromotion, PromotionPicker } from '../ui/promotion';
import { FriendSetup } from '../online/setup';
import { BOTS, botMove, gameEnding, gamePgn, takeBack, type Bot, type Side } from './bots';
import './play.css';

type ColorChoice = Side | 'random';
interface Match { bot: Bot; side: Side; id: number }

export function PlayPage({ friend = false }: { friend?: boolean }) {
  const [opponent, setOpponent] = useState<'bot' | 'friend'>(friend ? 'friend' : 'bot');
  const [bot, setBot] = useState(BOTS[0]);
  const [color, setColor] = useState<ColorChoice>('white');
  const [match, setMatch] = useState<Match | null>(null);
  const sequence = useRef(0);
  const roster = useRef<HTMLDivElement>(null);
  const [selection, setSelection] = useState<{ top: number; height: number } | null>(null);
  const settings = useSettings();
  const start = () => {
    setMatch({ bot, side: color === 'random' ? (Math.random() < 0.5 ? 'white' : 'black') : color, id: ++sequence.current });
    window.scrollTo(0, 0);
  };

  // One selection surface follows the chosen opponent. Measure actual rows so
  // wrapped descriptions, font loading and narrow screens don't misalign it.
  useLayoutEffect(() => {
    const element = roster.current;
    if (!element) return;
    const measure = () => {
      const row = element.querySelector<HTMLInputElement>('input:checked')?.closest('.bot-option') as HTMLElement | null;
      if (!row) return;
      const next = { top: row.offsetTop, height: row.offsetHeight };
      setSelection((previous) => previous?.top === next.top && previous.height === next.height ? previous : next);
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, [bot.id, !!match, opponent]);

  return (
    <main class={`play-page ${match ? 'play-active' : 'play-setup'}`}>
      {match ? (
        <MatchGame key={match.id} bot={match.bot} side={match.side} onChoose={() => setMatch(null)} onRematch={() => setMatch({ ...match, id: ++sequence.current })} />
      ) : (
        <>
          <div class="play-stage play-preview" aria-hidden="true">
            {opponent === 'friend'
              ? <div class="play-player"><Piece role="pawn" color="black" /><strong>Your friend</strong><span>Joins by link</span></div>
              : <div class="play-player"><Piece key={`piece-${bot.id}`} role={bot.piece} color={color === 'black' ? 'white' : 'black'} class="play-opponent-piece" /><strong key={`name-${bot.id}`}>{bot.name}</strong><span>{bot.level}</span></div>}
            <div class="board play-board">
              <Board fen={new Chess().fen()} orientation={color === 'black' ? 'black' : 'white'} shapes={[]} coordinates={settings.coordinates} animate={settings.motion} />
            </div>
            <div class="play-player"><Piece role="king" color={opponent === 'bot' && color === 'black' ? 'black' : 'white'} /><strong>You</strong><span>{opponent === 'friend' ? 'Online' : 'No clock'}</span></div>
          </div>
          <section class="play-panel" aria-labelledby="play-title">
            <header class="play-heading"><h1 id="play-title">Find your opponent.</h1><p>{opponent === 'friend' ? 'Make a link, send it, and play in real time.' : 'Take your time. Try an idea. Play again.'}</p></header>
            <div class="segmented segmented-wide play-mode" role="radiogroup" aria-label="Opponent">
              {(['bot', 'friend'] as const).map((o) => (
                <button key={o} type="button" role="radio" aria-checked={opponent === o} onClick={() => setOpponent(o)}>{o === 'bot' ? 'A bot' : 'A friend'}</button>
              ))}
            </div>
            {opponent === 'friend' ? <FriendSetup /> : <>
            <fieldset class="bot-picker">
              <legend>Choose a bot</legend>
              <div class="bot-roster" ref={roster}>
                {selection ? <span class="bot-selection" aria-hidden="true" style={{ transform: `translateY(${selection.top}px)`, height: `${selection.height}px` }} /> : null}
                {BOTS.map((b) => (
                  <label key={b.id} class="bot-option">
                    <input type="radio" name="bot" value={b.id} checked={bot.id === b.id} onChange={() => setBot(b)} />
                    <Piece role={b.piece} color="black" />
                    <span class="bot-copy"><span class="bot-name"><strong>{b.name}</strong><span>{b.level}</span></span><span class="bot-description">{b.description}</span></span>
                  </label>
                ))}
              </div>
            </fieldset>
            <fieldset class="play-colors"><legend>You play</legend><div class="play-color-options">
              {(['white', 'random', 'black'] as const).map((c) => (
                <label class="play-color" key={c}><input type="radio" name="color" checked={color === c} onChange={() => setColor(c)} /><span>{c === 'white' ? 'White' : c === 'black' ? 'Black' : 'Random'}</span></label>
              ))}
            </div></fieldset>
            <button type="button" class="button button-primary play-start" onClick={start}>Play {bot.name}</button>
            <p class="play-note">Free, with hints and takebacks. All five bots use Stockfish on your device.</p>
            </>}
          </section>
        </>
      )}
    </main>
  );
}

function MatchGame({ bot, side, onChoose, onRematch }: { bot: Bot; side: Side; onChoose: () => void; onRematch: () => void }) {
  const game = useRef<Chess | null>(null);
  if (!game.current) {
    game.current = new Chess();
    game.current.setHeader('Date', new Date().toISOString().slice(0, 10).replaceAll('-', '.'));
  }
  const chess = game.current;
  const engine = useRef<LiveEngine | null>(null);
  const request = useRef(0);
  const [fen, setFen] = useState(chess.fen());
  const [orientation, setOrientation] = useState(side);
  const [resigned, setResigned] = useState(false);
  const [busy, setBusy] = useState<'bot' | 'hint' | null>(null);
  const [failure, setFailure] = useState(false);
  const [retry, setRetry] = useState(0);
  const [hint, setHint] = useState<{ uci: string; san: string } | null>(null);
  const [promoting, setPromoting] = useState<{ from: Key; to: Key } | null>(null);
  const [confirm, setConfirm] = useState<'resign' | 'choose' | null>(null);
  const [moveText, setMoveText] = useState('');
  const [moveError, setMoveError] = useState('');
  const settings = useSettings();
  const list = useRef<HTMLOListElement>(null);
  const end = gameEnding(chess, side, resigned);
  const myTurn = !end && chess.turn() === side[0];
  const history = chess.history({ verbose: true });
  const last = history.at(-1);

  const cancel = () => {
    request.current++;
    engine.current?.stop();
    setBusy(null);
    setHint(null);
  };
  const sync = () => {
    setFen(chess.fen());
    setMoveText('');
    setMoveError('');
  };
  const getEngine = () => engine.current ?? (engine.current = new LiveEngine());
  useEffect(() => () => {
    request.current++;
    engine.current?.terminate();
  }, []);

  useEffect(() => {
    if (end || chess.turn() === side[0]) return;
    const id = ++request.current;
    let timer: ReturnType<typeof setTimeout> | undefined;
    setBusy('bot');
    setFailure(false);
    const began = Date.now();
    Promise.resolve().then(() => id !== request.current ? null : getEngine().analyse(fen, bot.depth, undefined, {
      skill: bot.skill, moveTime: bot.moveTime, moves: chess.history({ verbose: true }).map((m) => m.lan),
    })).then((result) => {
      if (id !== request.current || !result) return;
      const move = botMove(chess, result, bot);
      if (!move) throw new Error('No legal reply');
      timer = setTimeout(() => {
        if (id !== request.current) return;
        if (!playUci(chess, move)) setFailure(true);
        else sync();
        setBusy(null);
      }, Math.max(0, 450 - (Date.now() - began)));
    }).catch(() => {
      if (id !== request.current) return;
      setBusy(null);
      setFailure(true);
    });
    return () => {
      clearTimeout(timer);
      request.current++;
      engine.current?.stop();
    };
  }, [fen, !!end, retry]);

  useEffect(() => {
    if (list.current) list.current.scrollTop = list.current.scrollHeight;
  }, [fen]);

  const playMine = (from: Key, to: Key, promotion = 'q') => {
    if (resigned || chess.isGameOver() || chess.turn() !== side[0] || confirm) return;
    if (!playUci(chess, from + to + promotion)) return;
    cancel();
    setFailure(false);
    setPromoting(null);
    sync();
  };
  const movable = useMemo<Movable | undefined>(() => !myTurn || promoting || confirm ? undefined : {
    color: side, dests: destsOf(chess),
    onMove: (from, to) => {
      cancel();
      if (isPromotion(fen, from, to)) setPromoting({ from, to });
      else playMine(from, to);
    },
  }, [fen, myTurn, promoting, confirm]);
  const shownFen = promoting ? new Chess(fen).move({ ...promoting, promotion: 'q' }).after : fen;
  const shapes = useMemo(() => hint && myTurn ? [arrowShape(hint.uci)] : [], [hint, myTurn]);

  const askHint = () => {
    if (!myTurn || promoting || confirm || busy === 'hint') return;
    cancel();
    const id = request.current;
    setBusy('hint');
    setFailure(false);
    Promise.resolve().then(() => id !== request.current ? null : getEngine().analyse(fen, 16, undefined, {
      moveTime: 1000, moves: chess.history({ verbose: true }).map((m) => m.lan),
    })).then((result) => {
      if (id !== request.current || !result) return;
      const m = result.best ? playUci(new Chess(fen), result.best) : null;
      if (!m) throw new Error('No hint');
      setHint({ uci: m.lan, san: m.san });
      setBusy(null);
    }).catch(() => {
      if (id !== request.current) return;
      setBusy(null);
      setFailure(true);
    });
  };
  const undo = () => {
    cancel();
    setPromoting(null);
    setFailure(false);
    takeBack(chess, side);
    sync();
  };
  const restartEngine = () => {
    cancel();
    engine.current?.terminate();
    engine.current = null;
    setFailure(false);
    setRetry((n) => n + 1);
  };
  const download = () => {
    const url = URL.createObjectURL(new Blob([gamePgn(chess, bot, side, end?.result ?? '*')], { type: 'application/x-chess-pgn' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = `kibitz-${bot.id}.pgn`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };
  const submitMove = (e: Event) => {
    e.preventDefault();
    if (!myTurn || promoting || confirm) return;
    try {
      const m = new Chess(fen).move(moveText.trim());
      playMine(m.from, m.to, m.promotion);
    } catch { setMoveError('Try a legal move such as e4, Nf3, or O-O.'); }
  };
  const opponentSide = side === 'white' ? 'black' : 'white';
  const player = (color: Side) => <div class="play-player" data-active={!end && chess.turn() === color[0] ? '' : undefined} data-thinking={!end && color !== side && busy === 'bot' ? '' : undefined}><Piece role={color === side ? 'king' : bot.piece} color={color} /><strong>{color === side ? 'You' : bot.name}</strong><span>{color === side ? `${side === 'white' ? 'White' : 'Black'} · No clock` : bot.level}</span></div>;
  const status = end?.title ?? (failure ? (myTurn ? 'The hint could not load.' : 'The bot could not reply.') : promoting ? 'Choose your promotion.' : !myTurn ? `${bot.name} is thinking…` : chess.inCheck() ? 'Your move. You are in check.' : 'Your move.');
  const detail = end?.detail ?? (hint ? `Try ${hint.san}. Follow the arrow on the board.` : busy === 'hint' ? 'Finding a hint…' : failure ? 'Restart the engine to try again. Your game is kept.' : 'Hints and takebacks are always available.');

  return <>
    <section class="play-stage" aria-label="Game board">
      {player(orientation === side ? opponentSide : side)}
      <div class="board play-board">
        <Board fen={shownFen} orientation={orientation} lastMove={last ? [last.from, last.to] : undefined} shapes={shapes} movable={movable} coordinates={settings.coordinates} animate={settings.motion} />
        {promoting ? <PromotionPicker square={promoting.to} color={side} orientation={orientation} onPick={(piece) => playMine(promoting.from, promoting.to, piece)} onCancel={() => setPromoting(null)} /> : null}
      </div>
      {player(orientation)}
    </section>
    <section class="play-panel" aria-label="Game controls">
      <header class="play-heading"><h1>You vs {bot.name}</h1><p>{bot.level} opponent</p></header>
      <div class="play-status" role="status" data-ending={end ? '' : undefined}><h2 key={status}>{status}</h2><p key={detail}>{detail}</p></div>
      {failure && !end ? <button class="button" type="button" onClick={restartEngine}>Restart engine</button> : null}
      {end ? <div class="play-actions play-end">
        {history.length ? <a class="button button-primary" href={reviewHash(gamePgn(chess, bot, side, end.result), side === 'white' ? 'w' : 'b')}>Review this game</a> : null}
        <button class="button" type="button" onClick={onRematch}>Rematch</button>
        <button class="button" type="button" onClick={onChoose}>Choose another bot</button>
      </div> : <>
        <div class="play-actions">
          <button class="button" type="button" disabled={!myTurn || !!promoting || !!confirm || busy === 'hint' || failure} onClick={askHint}>{busy === 'hint' ? 'Finding hint…' : 'Hint'}</button>
          <button class="button" type="button" disabled={!history.some((m) => m.color === side[0]) || !!confirm} onClick={undo}>Take back</button>
          <button class="button" type="button" disabled={!!promoting} onClick={() => setOrientation((s) => s === 'white' ? 'black' : 'white')}>Flip board</button>
        </div>
        <form class="play-move-form" onSubmit={submitMove}>
          <label class="field"><span>Enter a move</span><input value={moveText} onInput={(e) => { setMoveText(e.currentTarget.value); setMoveError(''); }} disabled={!myTurn || !!promoting || !!confirm} placeholder="e4, Nf3, O-O…" spellcheck={false} autocomplete="off" autocapitalize="off" aria-invalid={!!moveError} aria-describedby={moveError ? 'play-move-error' : undefined} /></label>
          <button class="button" type="submit" disabled={!myTurn || !moveText.trim() || !!promoting || !!confirm}>Play move</button>
        </form>
        {moveError ? <p class="form-error" id="play-move-error" role="alert">{moveError}</p> : null}
      </>}
      <div class="play-scoresheet" key="scoresheet"><h2>Moves</h2>{history.length ? <ol ref={list} class="play-moves" aria-label="Moves">
        {history.filter((_, i) => i % 2 === 0).map((m, i) => <li key={i}><span>{i + 1}.</span><span class="play-san" key={m.lan}>{m.san}</span><span class={history[i * 2 + 1] ? 'play-san' : ''} key={history[i * 2 + 1]?.lan ?? 'empty'}>{history[i * 2 + 1]?.san ?? ''}</span></li>)}
      </ol> : <p class="play-note">{side === 'white' ? 'Play your first move on the board or enter it above.' : `${bot.name} plays White and moves first.`}</p>}</div>
      {confirm && !end ? <div class="play-confirm" role="group" aria-label="Confirm game action"><p>{confirm === 'resign' ? 'Resign this game?' : 'Leave this game and choose another bot?'}</p><div class="play-actions">
        <button class="button" type="button" onClick={() => setConfirm(null)}>Keep playing</button>
        <button class="button" type="button" onClick={() => { cancel(); setPromoting(null); if (confirm === 'resign') { setResigned(true); setConfirm(null); } else onChoose(); }}>{confirm === 'resign' ? 'Yes, resign' : 'Leave game'}</button>
      </div></div> : <div class="play-actions play-secondary">
        {history.length ? <button class="button" type="button" onClick={download}>Download PGN</button> : null}
        {!end ? <><button class="button" type="button" disabled={!!promoting} onClick={() => setConfirm('resign')}>Resign</button><button class="button" type="button" disabled={!!promoting} onClick={() => setConfirm('choose')}>Change bot</button></> : null}
      </div>}
    </section>
  </>;
}
