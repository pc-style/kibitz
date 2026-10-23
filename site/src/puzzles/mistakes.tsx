import type { DrawShape } from '@lichess-org/chessground/draw';
import type { Key } from '@lichess-org/chessground/types';
import { Chess } from 'chess.js';
import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import { LiveEngine, type PositionEval } from '../engine';
import type { Game } from '../game';
import { arrowShape, colorOf, destsOf } from '../learn/play';
import { Coach, focusQuietly, useLater } from '../learn/ui';
import { lineWin, type Grade, type MoveReview } from '../review';
import { useSettings } from '../settings';
import { play as sound } from '../sound';
import { Board, type Movable } from '../ui/board';
import { badgeSvg, GRADE_INFO, GradeIcon } from '../ui/grades';
import { isPromotion, PromotionPicker } from '../ui/promotion';
import { PuzzleShell } from './shell';

/**
 * Your mistakes: positions from games reviewed here where you went wrong, saved as puzzles to find the better
 * move. Kept in this browser only, like everything else.
 */
export interface Mistake {
  id: string;
  /** The position you went wrong in. */
  fen: string;
  /** Your opponent's move just before, played out first so you see what you were answering. */
  prev?: { fen: string; uci: string };
  /** The game up to this position (its first position and every move since), so repetitions count as draws. */
  history?: { from: string; moves: string[] };
  played: string;
  san: string;
  grade: Grade;
  /** The engine's line from this position, and the first moves it rated as good as the best. */
  best: string[];
  good: string[];
  /** The best line's win chance for you (0-100): another move within a few points of it is right too. */
  bestWin: number;
  game: { white: string; black: string; date?: string; href: string; move: string };
  added: number;
  tries: number;
  solved: number;
  /** How the last try went. */
  last?: boolean;
}

const KEY = 'kibitz:mistakes';
/** Enough for months of games; the oldest solved ones go first when it's full. */
const LIMIT = 300;
/** Grades worth turning into a puzzle: inaccuracies are too fine a call to be "the" answer. */
const SAVE: ReadonlySet<Grade> = new Set(['mistake', 'miss', 'blunder']);
/** A move within this many win-chance points of the best one counts, as in the review's Retry. */
const SLACK = 5;

const UCI = /^[a-h][1-8][a-h][1-8][qrbn]?$/;
const text = (v: unknown): v is string => typeof v === 'string';
const legalFen = (fen: unknown) => {
  try {
    return text(fen) && !!new Chess(fen);
  } catch {
    return false;
  }
};

/** The opponent's move before the mistake: legal, and landing on the mistake's position. */
function leadsTo(prev: unknown, fen: string): boolean {
  const p = prev as Partial<NonNullable<Mistake['prev']>> | null;
  if (!p || !legalFen(p.fen) || !text(p.uci) || !UCI.test(p.uci)) return false;
  try {
    const after = new Chess(p.fen).move({ from: p.uci.slice(0, 2), to: p.uci.slice(2, 4), promotion: p.uci[4] }).after;
    return after.split(' ').slice(0, 4).join(' ') === fen.split(' ').slice(0, 4).join(' ');
  } catch {
    return false;
  }
}

/** Every field the page reads, checked: a damaged entry is dropped on its own instead of breaking practice. */
function usable(m: unknown): m is Mistake {
  if (!m || typeof m !== 'object') return false;
  const x = m as Partial<Mistake>;
  const game = x.game as Partial<Mistake['game']> | undefined;
  return (
    text(x.id) &&
    legalFen(x.fen) &&
    (x.prev === undefined || leadsTo(x.prev, x.fen as string)) &&
    (x.history === undefined || (!!x.history && legalFen(x.history.from) && Array.isArray(x.history.moves) && x.history.moves.every((u) => text(u) && UCI.test(u)))) &&
    text(x.played) &&
    UCI.test(x.played) &&
    text(x.san) &&
    !!x.grade &&
    SAVE.has(x.grade) &&
    Array.isArray(x.best) &&
    x.best.length > 0 &&
    x.best.every((u) => text(u) && UCI.test(u)) &&
    Array.isArray(x.good) &&
    x.good.every(text) &&
    typeof x.bestWin === 'number' &&
    !!game &&
    text(game.white) &&
    text(game.black) &&
    text(game.href) &&
    text(game.move) &&
    typeof x.added === 'number' &&
    typeof x.tries === 'number' &&
    typeof x.solved === 'number'
  );
}

/** What storage holds, or null when it can't be read at all (blocked), which is not the same as none saved. */
function read(): Mistake[] | null {
  let text: string | null;
  try {
    text = localStorage.getItem(KEY);
  } catch {
    return null;
  }
  try {
    const saved: unknown = JSON.parse(text ?? '[]');
    return Array.isArray(saved) ? saved.filter(usable) : [];
  } catch {
    return [];
  }
}

let current = read() ?? [];
const listeners = new Set<(m: Mistake[]) => void>();
/** A write failed: memory holds mistakes storage doesn't, so changes start from memory (see progress.ts). */
let unsaved = false;

function save(list: Mistake[]) {
  current = list;
  try {
    localStorage.setItem(KEY, JSON.stringify(list));
    unsaved = false;
  } catch {
    // Full or blocked storage: they last for this visit.
    unsaved = true;
  }
  for (const listen of listeners) listen(current);
}

/** Storage, which another tab may have just changed, unless writing has failed here. */
const latest = () => (unsaved ? current : (read() ?? current));

// Another tab's changes, unless this tab holds mistakes storage never got.
window.addEventListener('storage', (e) => {
  if (e.key !== KEY || unsaved) return;
  current = read() ?? current;
  for (const listen of listeners) listen(current);
});

export function useMistakes(): Mistake[] {
  const [m, setM] = useState(current);
  useEffect(() => {
    listeners.add(setM);
    setM(current);
    return () => void listeners.delete(setM);
  }, []);
  return m;
}

function hash(text: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) h = Math.imul(h ^ text.charCodeAt(i), 0x01000193) >>> 0;
  return h.toString(36);
}

/**
 * Which side of a reviewed game is you: "You" in a game against a Kibitz bot, or the username you last loaded
 * games for. Null when it can't tell (a pasted game between two other people, say).
 */
export function yourSide(headers: Record<string, string>): 'w' | 'b' | null {
  const white = headers.White?.trim().toLowerCase();
  const black = headers.Black?.trim().toLowerCase();
  let me: string | undefined;
  try {
    me = localStorage.getItem('kibitz:user')?.trim().toLowerCase() || undefined;
  } catch {
    // No storage, no name.
  }
  for (const name of ['you', me]) {
    if (!name || white === black) continue;
    if (white === name) return 'w';
    if (black === name) return 'b';
  }
  return null;
}

/** The mistakes one side made in a reviewed game, as puzzles. */
export function mistakesIn(game: Game, evals: (PositionEval | undefined)[], moves: (MoveReview | undefined)[], side: 'w' | 'b', href: string): Mistake[] {
  const out: Mistake[] = [];
  game.plies.forEach((ply, i) => {
    const review = moves[i];
    const lines = evals[i]?.lines ?? [];
    if (ply.color !== side || !review || !SAVE.has(review.grade) || !lines[0]?.pv.length) return;
    const bestWin = lineWin(lines[0]);
    const prev = game.plies[i - 1];
    out.push({
      id: hash(`${ply.fenBefore} ${ply.uci}`),
      fen: ply.fenBefore,
      prev: prev ? { fen: prev.fenBefore, uci: prev.uci } : undefined,
      history: { from: game.fens[0], moves: game.plies.slice(0, i).map((p) => p.uci) },
      played: ply.uci,
      san: ply.san,
      grade: review.grade,
      best: lines[0].pv.slice(0, 6),
      good: lines.filter((l) => l.pv[0] && l.pv[0] !== ply.uci && bestWin - lineWin(l) <= SLACK).map((l) => l.pv[0]),
      bestWin,
      game: {
        white: game.headers.White || 'White',
        black: game.headers.Black || 'Black',
        date: game.headers.Date && !game.headers.Date.includes('?') ? game.headers.Date.replaceAll('.', '-') : undefined,
        href,
        move: `${ply.moveNumber}${ply.color === 'w' ? '.' : '...'} ${ply.san}`,
      },
      added: Date.now(),
      tries: 0,
      solved: 0,
    });
  });
  return out;
}

/** Saves a game's mistakes, keeping what's known about ones already saved. Returns how many it has. */
export function saveMistakes(found: Mistake[]): number {
  const list = latest();
  const known = new Set(list.map((m) => m.id));
  const fresh = found.filter((m) => !known.has(m.id));
  let next = [...fresh, ...list];
  if (next.length > LIMIT) {
    // Drop the oldest solved ones first, then the oldest of any.
    const keep = new Set(
      [...next]
        .sort((a, b) => Number(!!b.solved) - Number(!!a.solved) || a.added - b.added)
        .slice(next.length - LIMIT)
        .map((m) => m.id),
    );
    next = next.filter((m) => keep.has(m.id));
  }
  if (fresh.length) save(next);
  return found.length;
}

function record(id: string, ok: boolean) {
  save(latest().map((m) => (m.id === id ? { ...m, tries: m.tries + 1, solved: m.solved + (ok ? 1 : 0), last: ok } : m)));
}

function remove(id: string) {
  save(latest().filter((m) => m.id !== id));
}

/** Never tried first, newest first; then the ones missed last time; then the rest. */
const queueOf = (list: Mistake[]) =>
  [...list].sort((a, b) => rank(a) - rank(b) || b.added - a.added);
const rank = (m: Mistake) => (!m.tries ? 0 : m.last === false ? 1 : !m.solved ? 1 : 2);

/**
 * The mistake's position with the game's moves behind it, when they were saved and still lead there; otherwise
 * just the position.
 */
function replay(m: Mistake): Chess {
  if (m.history) {
    try {
      const chess = new Chess(m.history.from);
      for (const uci of m.history.moves) chess.move({ from: uci.slice(0, 2), to: uci.slice(2, 4), promotion: uci[4] });
      if (chess.fen().split(' ').slice(0, 4).join(' ') === m.fen.split(' ').slice(0, 4).join(' ')) return chess;
    } catch {
      // A damaged history: the position alone will do.
    }
  }
  return new Chess(m.fen);
}

// ---------------------------------------------------------------- the page

export function MistakesPage() {
  const mistakes = useMistakes();
  const [practising, setPractising] = useState<string | null>(null);
  // The practice order is fixed when practice starts, so solving one doesn't reshuffle what comes next; the
  // entries themselves always come fresh (another tab may have solved or removed one).
  const order = useMemo(() => queueOf(mistakes).map((m) => m.id), [practising === null]);
  const list = useMemo(() => queueOf(mistakes), [mistakes]);
  const byId = new Map(mistakes.map((m) => [m.id, m]));
  const queue = order.flatMap((id) => byId.get(id) ?? []);
  const at = practising ? queue.findIndex((m) => m.id === practising) : -1;
  // The one being practised was removed (in another tab, say): back to the list.
  useEffect(() => {
    if (practising && at < 0) setPractising(null);
  }, [practising, at]);

  if (practising && at >= 0) {
    const m = queue[at];
    const next = queue[at + 1];
    return <MistakePuzzle key={m.id} mistake={m} position={`${at + 1} of ${queue.length}`} onNext={next ? () => setPractising(next.id) : undefined} onList={() => setPractising(null)} />;
  }

  return (
    <main class="puzzles mistakes">
      <header class="learn-head">
        <a class="lesson-back" href="#/puzzles">
          ← Puzzles
        </a>
        <h1>Your mistakes</h1>
        <p class="home-lede">
          Every mistake and blunder from games you've reviewed here, as a puzzle: the position before your move, to find what you
          should have played.
        </p>
        {mistakes.length ? (
          <div class="learn-progress">
            <button class="button button-primary" type="button" onClick={() => setPractising(list[0].id)} ref={focusQuietly}>
              {list.some((m) => !m.solved) ? 'Practise' : 'Practise again'}
            </button>
            <span class="muted">
              {mistakes.filter((m) => m.solved).length} of {mistakes.length} solved
            </span>
          </div>
        ) : null}
      </header>

      {mistakes.length ? (
        <ul class="mistake-list">
          {list.map((m) => (
            <li key={m.id}>
              <button type="button" class="mistake-row" onClick={() => setPractising(m.id)}>
                <GradeIcon grade={m.grade} solid />
                <span class="mistake-text">
                  <strong class="san">{m.game.move}</strong>
                  <span>
                    {m.game.white} vs {m.game.black}
                    {m.game.date ? ` · ${m.game.date}` : ''}
                  </span>
                </span>
                <span class={`mistake-state ${m.solved ? 'is-solved' : m.tries ? 'is-missed' : ''}`}>{m.solved ? 'Solved' : m.tries ? 'Try again' : 'New'}</span>
              </button>
              <button type="button" class="link-button mistake-remove" onClick={() => remove(m.id)} aria-label={`Remove ${m.game.move}`}>
                Remove
              </button>
            </li>
          ))}
        </ul>
      ) : (
        <section class="home-card mistakes-empty">
          <h2>Nothing here yet</h2>
          <p class="muted">
            Review a game you played, either a game against a Kibitz bot, or one of yours loaded from chess.com or lichess by username.
            When the review finishes, your mistakes and blunders from that game appear here.
          </p>
          <div class="learn-progress">
            <a class="button button-primary" href="#/analysis">
              Review a game
            </a>
            <a class="button" href="#/play">
              Play a bot
            </a>
          </div>
        </section>
      )}
    </main>
  );
}

/** One mistake as a puzzle: any move as good as the engine's best counts, checked with Stockfish if need be. */
function MistakePuzzle({ mistake, position, onNext, onList }: { mistake: Mistake; position: string; onNext?: () => void; onList: () => void }) {
  const later = useLater();
  const settings = useSettings();
  const color = colorOf(mistake.fen);
  const [fen, setFen] = useState(mistake.prev?.fen ?? mistake.fen);
  const [lastMove, setLastMove] = useState<Key[] | undefined>();
  const [status, setStatus] = useState<'intro' | 'play' | 'checking' | 'wrong' | 'played' | 'solved' | 'unchecked'>(mistake.prev ? 'intro' : 'play');
  const [mark, setMark] = useState<{ square: Key; ok: boolean } | null>(null);
  const [reveal, setReveal] = useState(false);
  const [promoting, setPromoting] = useState<{ from: Key; to: Key } | null>(null);
  const [answer, setAnswer] = useState<string | null>(null);
  const missed = useRef(false);
  const checker = useRef<LiveEngine | null>(null);
  const checking = useRef(0);
  useEffect(() => () => checker.current?.terminate(), []);

  useEffect(() => {
    if (!mistake.prev) return;
    later(() => {
      const m = new Chess(mistake.prev!.fen).move({ from: mistake.prev!.uci.slice(0, 2), to: mistake.prev!.uci.slice(2, 4), promotion: mistake.prev!.uci[4] });
      setFen(m.after);
      setLastMove([m.from as Key, m.to as Key]);
      setStatus('play');
    }, 700);
  }, []);

  const settle = (ok: boolean, uci: string, to: Key) => {
    setMark({ square: to, ok });
    if (ok) {
      setStatus('solved');
      setAnswer(uci);
      sound('correct', { delay: 0.12 });
      record(mistake.id, !missed.current);
      return;
    }
    if (!missed.current) record(mistake.id, false);
    missed.current = true;
    sound('wrong', { delay: 0.1 });
    setStatus(uci === mistake.played ? 'played' : 'wrong');
    later(() => {
      setFen(mistake.fen);
      setLastMove(mistake.prev ? [mistake.prev.uci.slice(0, 2) as Key, mistake.prev.uci.slice(2, 4) as Key] : undefined);
      setMark(null);
      setStatus('play');
    }, 1100);
  };

  // Seeing the answer means this try can't count as solved.
  const showBest = () => {
    if (!missed.current) record(mistake.id, false);
    missed.current = true;
    setReveal(true);
  };

  const onMove = (orig: Key, dest: Key, promotion?: string) => {
    if (status !== 'play') return;
    if (!promotion && isPromotion(fen, orig, dest)) return setPromoting({ from: orig, to: dest });
    setPromoting(null);
    // Played on top of the game so far, so chess.js and Stockfish both see a repetition for the draw it is.
    const chess = replay(mistake);
    let m;
    try {
      m = chess.move({ from: orig, to: dest, promotion });
    } catch {
      return;
    }
    setFen(chess.fen());
    setLastMove([orig, dest]);
    const uci = m.lan;
    if (uci === mistake.best[0] || mistake.good.includes(uci) || chess.isCheckmate()) return settle(true, uci, dest);
    if (uci === mistake.played) return settle(false, uci, dest);
    if (chess.isDraw()) return settle(mistake.bestWin - 50 <= SLACK, uci, dest);
    // A move the review didn't list: Stockfish decides whether it's as good.
    const run = ++checking.current;
    setStatus('checking');
    const history = chess.history({ verbose: true });
    (checker.current ??= new LiveEngine())
      .analyse(chess.fen(), 14, undefined, history.length > 1 ? { from: history[0].before, moves: history.map((h) => h.lan) } : {})
      .then((r) => {
        if (run !== checking.current || !r?.lines[0]) return;
        settle(mistake.bestWin - (100 - lineWin(r.lines[0])) <= SLACK, uci, dest);
      })
      .catch(() => {
        checker.current?.terminate();
        checker.current = null;
        if (run === checking.current) setStatus('unchecked');
      });
  };

  const movable = useMemo<Movable | undefined>(
    () => (status === 'play' && !promoting ? { color, dests: destsOf(new Chess(fen)), onMove: (o, d) => onMove(o, d) } : undefined),
    [fen, status, promoting],
  );
  const shapes = useMemo(() => {
    const out: DrawShape[] = [];
    if (mark) out.push({ orig: mark.square, customSvg: { html: badgeSvg(mark.ok ? 'best' : 'miss') } });
    if ((reveal && status === 'play') || (status === 'solved' && answer !== mistake.best[0])) out.push(arrowShape(mistake.best[0]));
    return out;
  }, [mark, reveal, status, answer]);

  const bestSan = useMemo(() => {
    try {
      return new Chess(mistake.fen).move({ from: mistake.best[0].slice(0, 2), to: mistake.best[0].slice(2, 4), promotion: mistake.best[0][4] }).san;
    } catch {
      return mistake.best[0];
    }
  }, [mistake]);

  const side = color === 'white' ? 'White' : 'Black';
  const say =
    status === 'solved'
      ? { tone: 'good' as const, lead: answer === mistake.best[0] ? `${bestSan}. That's it!` : 'That works too!', detail: answer === mistake.best[0] ? `In the game you played ${mistake.san}.` : `The engine's choice was ${bestSan}; in the game you played ${mistake.san}.` }
      : status === 'played'
        ? { tone: 'bad' as const, lead: `${mistake.san} is what you played.`, detail: `It was ${GRADE_INFO[mistake.grade].phrase}. Look for something better.` }
        : status === 'wrong'
          ? { tone: 'bad' as const, lead: 'Not quite.', detail: 'That move gives away too much. Try another.' }
          : status === 'checking'
            ? { tone: 'neutral' as const, lead: 'Checking that move…', detail: 'Stockfish is looking at it on your device.' }
            : status === 'unchecked'
              ? { tone: 'neutral' as const, lead: "That move couldn't be checked.", detail: 'The engine stopped. Try again, or see the best move.' }
              : { tone: 'neutral' as const, lead: status === 'intro' ? 'Your opponent played…' : 'Find a better move.', detail: `You're ${side}. In the game you played ${mistake.san} here.` };

  return (
    <PuzzleShell
      title="Your mistakes"
      aside={<span class="muted puzzle-date">{position}</span>}
      back={{ href: '#/puzzles/mistakes', label: 'Your mistakes', onClick: onList }}
      board={
        <div class="board puzzle-board">
          <Board
            fen={promoting ? new Chess(fen).move({ ...promoting, promotion: 'q' }).after : fen}
            orientation={color}
            lastMove={promoting ? [promoting.from, promoting.to] : lastMove}
            shapes={shapes}
            movable={movable}
            typing
            sound={!promoting}
            coordinates={settings.coordinates}
            animate={settings.motion}
          />
          {promoting ? (
            <PromotionPicker square={promoting.to} color={color} orientation={color} onPick={(p) => onMove(promoting.from, promoting.to, p)} onCancel={() => setPromoting(null)} />
          ) : null}
        </div>
      }
    >
      <Coach tone={say.tone} lead={say.lead}>
        <p class="coach-detail">{say.detail}</p>
      </Coach>
      <div class="lesson-actions">
        {status === 'solved' ? (
          onNext ? (
            <button class="button button-primary" type="button" onClick={onNext} ref={focusQuietly}>
              Next mistake
            </button>
          ) : (
            <button class="button button-primary" type="button" onClick={onList} ref={focusQuietly}>
              All done. Back to the list
            </button>
          )
        ) : (
          <>
            <button class="button" type="button" onClick={showBest} disabled={reveal || status !== 'play'}>
              Show the best move
            </button>
            {status === 'unchecked' ? (
              <button class="button" type="button" onClick={() => (setFen(mistake.fen), setMark(null), setStatus('play'))}>
                Try again
              </button>
            ) : null}
            {onNext ? (
              <button class="button" type="button" onClick={onNext}>
                Skip
              </button>
            ) : null}
          </>
        )}
      </div>
      <div class="puzzle-info">
        <p>
          <GradeIcon grade={mistake.grade} solid /> {mistake.game.move} · {mistake.game.white} vs {mistake.game.black}
        </p>
        <p>
          <a href={mistake.game.href}>Open the game review →</a>
        </p>
      </div>
    </PuzzleShell>
  );
}

/**
 * For the review's finished report: saves your mistakes from the game as puzzles and says so, or, when it can't
 * tell which side you were, asks.
 */
export function MistakesNote({ collect, names, side }: { collect: (side: 'w' | 'b') => Mistake[]; names: { w: string; b: string }; side: 'w' | 'b' | null }) {
  const [saved, setSaved] = useState<number | null>(null);
  const keep = (s: 'w' | 'b') => setSaved(saveMistakes(collect(s)));
  useEffect(() => {
    if (side) keep(side);
  }, [side]);
  const counts = useMemo(() => (side ? null : { w: collect('w').length, b: collect('b').length }), [side]);

  if (saved !== null)
    return (
      <p class="report-mistakes">
        {saved ? (
          <>
            {saved === 1 ? 'Your mistake from this game is saved as a puzzle.' : `Your ${saved} mistakes from this game are saved as puzzles.`}{' '}
            <a href="#/puzzles/mistakes">Practise {saved === 1 ? 'it' : 'them'} →</a>
          </>
        ) : (
          'No mistakes or blunders from you in this game, so nothing to practise.'
        )}
      </p>
    );
  if (!counts || (!counts.w && !counts.b)) return null;
  return (
    <div class="report-mistakes">
      <p>Was this your game? Save your mistakes as puzzles to practise.</p>
      <div class="lesson-actions">
        {(['w', 'b'] as const).map((s) => (
          <button key={s} type="button" class="button" disabled={!counts[s]} onClick={() => keep(s)}>
            I was {names[s]}
          </button>
        ))}
      </div>
    </div>
  );
}
