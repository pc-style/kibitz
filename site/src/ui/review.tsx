import type { DrawShape } from '@lichess-org/chessground/draw';
import type { Key } from '@lichess-org/chessground/types';
import { Chess } from 'chess.js';
import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import { analysePositions, LiveEngine, type PositionEval } from '../engine';
import { explainMove, moveName, summarizeGame } from '../explain';
import { epd, parseGame, type Game } from '../game';
import { boardHash } from '../sources';
import { GRADES, PHASES, gameAccuracy, lineWin, playerStats, reviewGame, type Grade, type MoveReview, type Score } from '../review';
import { Board, type Movable } from './board';
import { EvalGraph } from './graph';
import { GRADE_INFO, GradeIcon, NOTABLE, badgeSvg } from './grades';
import { useSettings } from '../settings';
import { useCue } from '../sound';
import { Piece } from './piece';
import { isPromotion, PromotionPicker } from './promotion';
import { reducedMotion } from './theme';

/** Grades where Retry is offered: the moves worth finding again. */
const RETRY: ReadonlySet<Grade> = new Set(['inaccuracy', 'mistake', 'miss', 'blunder']);
const SIDE = { w: 'White', b: 'Black' } as const;

interface Retry {
  status: 'trying' | 'checking' | 'unchecked' | 'correct' | 'wrong' | 'revealed';
  uci?: string;
}

/** Grades double-checked with a deeper search before the review is shown as done. */
const RECHECK: ReadonlySet<Grade> = new Set(['mistake', 'miss', 'blunder']);

/** A Retry answer within this many win-chance points of the best move counts, like a near-equal second line. */
const RETRY_SLACK = 5;

/** Plays a UCI move on a position, for showing Best and Retry attempts on the board. */
function play(fen: string, uci: string) {
  const chess = new Chess(fen);
  const m = chess.move({ from: uci.slice(0, 2), to: uci.slice(2, 4), promotion: uci[4] });
  return { fen: chess.fen(), from: m.from as Key, to: m.to as Key, san: m.san };
}

interface Openings {
  book: Set<string>;
  names: Record<string, string>;
}

function cacheKey(game: Game, depth: number): string {
  let h = 0x811c9dc5;
  for (const ch of game.fens.join('|')) h = Math.imul(h ^ ch.charCodeAt(0), 0x01000193) >>> 0;
  return `kibitz:v1:${depth}:${h.toString(36)}`;
}

/** A saved evaluation that has the shape the review reads; anything else means the cache is damaged. */
const isEval = (e: unknown): boolean =>
  e === null ||
  (typeof e === 'object' &&
    Array.isArray((e as PositionEval).lines) &&
    (e as PositionEval).lines.every((l) => !!l && Array.isArray(l.pv) && (typeof l.cp === 'number' || typeof l.mate === 'number')));

function readCache(key: string, total: number): (PositionEval | undefined)[] | null {
  try {
    const cached: unknown = JSON.parse(localStorage.getItem(key) ?? 'null');
    return Array.isArray(cached) && cached.length <= total && cached.every(isEval) ? cached : null;
  } catch {
    // Storage off, or a damaged entry: review from scratch.
    return null;
  }
}

export function Review({ pgn, orientation: initialOrientation }: { pgn: string; orientation: 'w' | 'b' }) {
  const parsed = useMemo(() => {
    try {
      return { game: parseGame(pgn) };
    } catch (err) {
      return { error: err instanceof Error ? err.message : String(err) };
    }
  }, [pgn]);

  if (!parsed.game) {
    return (
      <main class="notice">
        <h1>That game didn't load</h1>
        <p>{parsed.error}</p>
        <a class="button" href="#/analysis">
          Back to Analysis
        </a>
      </main>
    );
  }
  return <Reviewer game={parsed.game} initialOrientation={initialOrientation} />;
}

function Reviewer({ game, initialOrientation }: { game: Game; initialOrientation: 'w' | 'b' }) {
  const total = game.fens.length;
  const settings = useSettings();
  const depth = settings.depth;
  // Read a saved review synchronously so a revisit renders complete on the first frame.
  const [evals, setEvals] = useState<(PositionEval | undefined)[]>(() => readCache(cacheKey(game, depth), game.fens.length) ?? []);
  const [failure, setFailure] = useState<string>();
  // Try again after a failure keeps the positions already analysed.
  const [attempt, setAttempt] = useState(0);
  // Positions being searched again, deeper, to confirm mistakes and blunders.
  const [rechecking, setRechecking] = useState(0);
  const partial = useRef<{ key: string; evals: (PositionEval | undefined)[] }>({ key: '', evals: [] });
  const [index, setIndex] = useState(0);
  const [orientation, setOrientation] = useState(initialOrientation);
  const [openings, setOpenings] = useState<Openings | null>(null);
  // Like chess.com: a report first, then a move-by-move review with a coach comment.
  const [mode, setMode] = useState<'summary' | 'review'>('summary');
  const [retry, setRetry] = useState<Retry | null>(null);
  const [showBest, setShowBest] = useState(false);
  // A Retry answer sounds right or wrong once the verdict is in.
  const verdict = retry && (retry.status === 'correct' || retry.status === 'wrong') ? `${index}:${retry.uci}:${retry.status}` : null;
  useCue(verdict, (v) => (v ? (v.endsWith(':correct') ? 'correct' : 'wrong') : null));

  useEffect(() => {
    import('../openings.json').then(
      (m) => setOpenings({ book: new Set(m.default.book), names: m.default.names as Record<string, string> }),
      // Offline or a stale tab: review without book moves rather than wait forever.
      () => setOpenings({ book: new Set(), names: {} }),
    );
  }, []);

  useEffect(() => {
    const key = cacheKey(game, depth);
    // A saved review is used as is only when every position has lines (the last one may be scored by how
    // the game ended); a partial one is a head start, and the rest is analysed now.
    const usable = (readCache(key, total) ?? []).map((ev) => (ev?.lines.length ? ev : undefined));
    if (game.fens.every((_, i) => usable[i] || (i === total - 1 && game.ending))) {
      setEvals(usable);
      return;
    }
    const result: (PositionEval | undefined)[] =
      partial.current.key === key ? [...partial.current.evals] : usable.some(Boolean) ? usable : [];
    partial.current = { key, evals: result };
    setEvals([...result]);
    setFailure(undefined);
    setRechecking(0);
    const ctrl = new AbortController();
    // Each position goes with the moves that reached it, so the engine sees repetitions as draws.
    const position = (i: number) =>
      i === total - 1 && game.ending ? null : { fen: game.fens[i], from: game.fens[0], moves: game.plies.slice(0, i).map((p) => p.uci) };
    const store = (i: number, ev: PositionEval) => {
      result[i] = ev;
      setEvals([...result]);
    };
    analysePositions(
      game.fens.map((_, i) => (result[i] ? null : position(i))),
      depth,
      store,
      ctrl.signal,
    )
      .then(async () => {
        if (ctrl.signal.aborted) return;
        // A shallow search can miss a tactic and call a strong move a blunder (Quick once did that to Morphy's
        // 15.Bxd7+). Before showing the result, search both sides of every flagged move deeper.
        if (depth < 20) {
          const flagged = new Set(reviewGame(game, result, null).moves.flatMap((m, i) => (m && RECHECK.has(m.grade) ? [i, i + 1] : [])));
          if (flagged.size) {
            setRechecking(flagged.size);
            await analysePositions(game.fens.map((_, i) => (flagged.has(i) ? position(i) : null)), Math.min(22, depth + 6), store, ctrl.signal);
            setRechecking(0);
          }
        }
        if (ctrl.signal.aborted) return;
        try {
          localStorage.setItem(key, JSON.stringify(result));
        } catch {
          // Storage full: the review still works, it just won't be remembered.
        }
      })
      .catch((err) => {
        setRechecking(0);
        setFailure(err instanceof Error ? err.message : String(err));
      });
    return () => ctrl.abort();
  }, [game, depth, attempt]);


  const { scores, moves } = useMemo(() => reviewGame(game, evals, openings?.book ?? null), [game, evals, openings]);
  const analysed = scores.filter(Boolean).length;
  // Done only once every search, the deeper double-check included, has finished without failing.
  const complete = analysed === total && !rechecking && !failure;
  const accuracy = useMemo(
    () => (complete ? gameAccuracy(scores as Score[], game.plies[0].color === 'w') : undefined),
    [complete, scores],
  );
  const stats = useMemo(() => (complete ? playerStats(game, scores as Score[], moves) : undefined), [complete, scores, moves]);

  const h = game.headers;
  // PGN writes an unknown player as "?".
  const named = (n: string | undefined, fallback: string) => (n && n !== '?' ? n : fallback);
  const names = { w: named(h.White, 'White'), b: named(h.Black, 'Black') };
  const summary = useMemo(
    () => (accuracy ? summarizeGame(game, moves, accuracy, names) : undefined),
    [accuracy, moves],
  );

  // Held arrow keys and quick clicks step faster than the animations can play, so while stepping
  // is rapid the screen is marked data-rapid and badges, the comment and indicators update instantly.
  const root = useRef<HTMLDivElement>(null);
  const lastStep = useRef(0);
  const settle = useRef(0);
  const go = (i: number) => {
    const now = performance.now();
    root.current?.toggleAttribute('data-rapid', now - lastStep.current < 220);
    lastStep.current = now;
    clearTimeout(settle.current);
    settle.current = window.setTimeout(() => root.current?.removeAttribute('data-rapid'), 260);
    setMode('review');
    setIndex(Math.max(0, Math.min(total - 1, i)));
  };

  // Key moments: every flagged move, for "Next key move" (and the N / P keys).
  const keyMoments = useMemo(() => moves.flatMap((m, i) => (m && NOTABLE.has(m.grade) ? [i + 1] : [])), [moves]);
  const nextKey = keyMoments.find((k) => k > index);
  const prevKey = [...keyMoments].reverse().find((k) => k < index);

  const nav = useRef({ index, nextKey, prevKey });
  nav.current = { index, nextKey, prevKey };
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      // Not while typing, and not from inside Settings, whose own buttons take the keys.
      const target = e.target instanceof Element ? e.target : null;
      if (target?.closest('input, textarea, select, #settings') || e.metaKey || e.ctrlKey || e.altKey) return;
      const { index: i, nextKey: n, prevKey: p } = nav.current;
      const map: Record<string, number | undefined> = {
        ArrowLeft: i - 1,
        ArrowRight: i + 1,
        ArrowUp: 0,
        Home: 0,
        ArrowDown: total - 1,
        End: total - 1,
        n,
        p,
      };
      if (e.key in map) {
        e.preventDefault();
        const to = map[e.key];
        if (to !== undefined) go(to);
      } else if (e.key === 'f') setOrientation((o) => (o === 'w' ? 'b' : 'w'));
      else if (e.key === 'Escape') setRetry(null);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [total]);

  // Retry answers the engine didn't list are checked with a short search of their own.
  const [retryPromotion, setRetryPromotion] = useState<{ from: Key; to: Key } | null>(null);
  const checker = useRef<LiveEngine | null>(null);
  const checking = useRef(0);
  useEffect(() => () => checker.current?.terminate(), []);

  // Best and Retry belong to the move they were opened on.
  useEffect(() => {
    checking.current++;
    setRetry(null);
    setRetryPromotion(null);
    setShowBest(false);
  }, [index]);

  const ply = index > 0 ? game.plies[index - 1] : undefined;
  const move = index > 0 ? moves[index - 1] : undefined;
  const lines = index > 0 ? (evals[index - 1]?.lines ?? []) : [];
  const bestUci = move?.best ? lines[0]?.pv[0] : undefined;
  const canRetry = !!ply && !!move && RETRY.has(move.grade) && !!lines[0];

  const onRetryMove = (orig: Key, dest: Key, promotion?: string) => {
    if (!ply || !lines[0]) return;
    if (!promotion && isPromotion(ply.fenBefore, orig, dest)) return setRetryPromotion({ from: orig, to: dest });
    setRetryPromotion(null);
    const uci = `${orig}${dest}${promotion ?? ''}`;
    // The engine's top move counts, and so does its second choice when it's nearly as good.
    const listed = uci === lines[0].pv[0] || (!!lines[1] && uci === lines[1].pv[0] && lineWin(lines[0]) - lineWin(lines[1]) <= RETRY_SLACK);
    if (listed || uci === ply.uci) return setRetry({ status: listed ? 'correct' : 'wrong', uci });
    // Anything else gets its own search: a different move can be just as good.
    const run = ++checking.current;
    setRetry({ status: 'checking', uci });
    // The game up to this move, plus the attempt, so repetitions count as the draws they are.
    const before = game.plies.slice(0, index - 1).map((p) => p.uci);
    const after = new Chess(game.fens[0]);
    for (const m of [...before, uci]) after.move({ from: m.slice(0, 2), to: m.slice(2, 4), promotion: m[4] });
    // Only if this check is still the one on screen (not cancelled, retried, or left for another move).
    const judge = (win: number) =>
      run === checking.current &&
      setRetry((r) => (r?.status === 'checking' && r.uci === uci ? { status: lineWin(lines[0]) - win <= RETRY_SLACK ? 'correct' : 'wrong', uci } : r));
    if (after.isCheckmate()) return judge(100);
    if (after.isDraw()) return judge(50);
    (checker.current ??= new LiveEngine())
      .analyse(after.fen(), Math.min(depth, 16), undefined, { from: game.fens[0], moves: [...before, uci] })
      .then((r) => r?.lines[0] && judge(100 - lineWin(r.lines[0])))
      .catch(() => {
        checker.current?.terminate();
        checker.current = null;
        if (run === checking.current) setRetry((r) => (r?.status === 'checking' && r.uci === uci ? { status: 'unchecked', uci } : r));
      });
  };

  // What the board shows: the game position, or a Best / Retry variation on top of it.
  const view = useMemo(() => {
    const badge = (grade: Grade, at: Key): DrawShape => ({ orig: at, customSvg: { html: badgeSvg(grade) } });
    if (ply && retry) {
      if (retry.status === 'trying') {
        const prev = game.plies[index - 2];
        const color = ply.color === 'w' ? ('white' as const) : ('black' as const);
        const dests = new Map<Key, Key[]>();
        for (const m of new Chess(ply.fenBefore).moves({ verbose: true })) dests.set(m.from as Key, [...(dests.get(m.from as Key) ?? []), m.to as Key]);
        const movable: Movable = { color, dests, onMove: onRetryMove };
        return { fen: ply.fenBefore, lastMove: prev ? [prev.from, prev.to] : undefined, shapes: [], movable };
      }
      const uci = retry.status === 'revealed' ? lines[0].pv[0] : retry.uci!;
      const p = play(ply.fenBefore, uci);
      const shapes = retry.status === 'checking' || retry.status === 'unchecked' ? [] : [badge(retry.status === 'wrong' ? 'miss' : 'best', p.to)];
      return { fen: p.fen, lastMove: [p.from, p.to], shapes };
    }
    if (ply && showBest && bestUci) {
      const p = play(ply.fenBefore, bestUci);
      return { fen: p.fen, lastMove: [p.from, p.to], shapes: [badge('best', p.to)] };
    }
    const shapes: DrawShape[] = [];
    if (ply && move) {
      shapes.push(badge(move.grade, ply.to));
      if (bestUci && settings.arrows) shapes.push({ orig: bestUci.slice(0, 2) as Key, dest: bestUci.slice(2, 4) as Key, brush: 'best' });
    }
    return { fen: game.fens[index], lastMove: ply ? [ply.from, ply.to] : undefined, shapes };
  }, [index, ply, move, retry, showBest, bestUci, lines, settings.arrows]);

  const opening = useMemo(() => {
    if (!openings) return game.headers.Opening;
    let name = game.headers.Opening;
    for (let i = 0; i < Math.min(index, game.plies.length); i++) name = openings.names[epd(game.plies[i].fenAfter)] ?? name;
    return name;
  }, [openings, index, game]);

  // One short announcement once stepping pauses, instead of re-reading the coach card on every move.
  const [announcement, setAnnouncement] = useState('');
  useEffect(() => {
    const text = !ply
      ? 'Starting position'
      : `${moveName(game, index - 1)}${move ? `, ${GRADE_INFO[move.grade].label.toLowerCase()}${move.best ? `. Best was ${move.best}` : ''}` : ''}`;
    const timer = setTimeout(() => setAnnouncement(text), 400);
    return () => clearTimeout(timer);
  }, [index, move?.grade, move?.best]);

  const jumpTo = (grade: Grade, color: 'w' | 'b') => {
    const hits = game.plies.flatMap((p, i) => (p.color === color && moves[i]?.grade === grade ? [i + 1] : []));
    if (hits.length) go(hits.find((x) => x > index) ?? hits[0]);
  };

  const player = (c: 'w' | 'b') => ({
    name: names[c],
    elo: c === 'w' ? h.WhiteElo : h.BlackElo,
    accuracy: accuracy?.[c],
  });
  const top = orientation === 'w' ? 'b' : 'w';
  const bottom = orientation;
  const score = scores[index];
  const title = [
    `${names.w} vs ${names.b}`,
    h.Result && h.Result !== '*' ? h.Result.replace('1/2-1/2', '½-½') : '',
    h.Date && !h.Date.includes('?') ? h.Date.replaceAll('.', '-') : '',
  ]
    .filter(Boolean)
    .join(' · ');

  return (
    <div class={`review ${settings.evalBar ? '' : 'review-no-bar'}`} ref={root}>
      <section class="stage">
        <PlayerStrip {...player(top)} color={top} />
        <div class="board-row">
          {settings.evalBar ? <EvalBar score={score} orientation={orientation} /> : null}
          <div class="board">
            <Board
              fen={view.fen}
              orientation={orientation === 'w' ? 'white' : 'black'}
              lastMove={view.lastMove}
              shapes={view.shapes}
              movable={retryPromotion ? undefined : view.movable}
              typing={!!view.movable}
              sound
              coordinates={settings.coordinates}
              animate={settings.motion}
            />
            {retryPromotion && ply ? (
              <PromotionPicker
                square={retryPromotion.to}
                color={ply.color === 'w' ? 'white' : 'black'}
                orientation={orientation === 'w' ? 'white' : 'black'}
                onPick={(piece) => onRetryMove(retryPromotion.from, retryPromotion.to, piece)}
                onCancel={() => setRetryPromotion(null)}
              />
            ) : null}
          </div>
        </div>
        <PlayerStrip {...player(bottom)} color={bottom} />
        <EvalGraph scores={scores} moves={moves} current={index} onSelect={go} />
        {complete ? <TurningPoints game={game} moves={moves} current={index} onSelect={go} /> : null}
        <p class="progress" role="status">
          {failure ? (
            <span class="progress-error">
              Engine stopped: {failure}{' '}
              <button type="button" class="link-button" onClick={() => setAttempt((n) => n + 1)}>
                Try again
              </button>
            </span>
          ) : complete ? (
            `Reviewed at depth ${depth} with Stockfish 19 on your device. Arrows step through moves, N jumps to the next key move, F flips the board.`
          ) : (
            'Stockfish is running in this tab. Moves get graded as their positions finish.'
          )}
        </p>
      </section>

      <aside class="panel">
        {mode === 'summary' ? (
          <Report
            title={title}
            game={game}
            moves={moves}
            accuracy={accuracy}
            stats={stats}
            summary={summary}
            names={names}
            analysed={analysed}
            total={total}
            failure={failure}
            complete={complete}
            rechecking={rechecking}
            onRetry={() => setAttempt((n) => n + 1)}
            onJump={jumpTo}
            onStart={() => go(keyMoments[0] ?? 1)}
          />
        ) : (
          <>
            <div class="panel-head">
              <button type="button" class="link-button" onClick={() => setMode('summary')}>
                <span aria-hidden="true">←</span> Summary
              </button>
              <span class="panel-title">Game Review</span>
            </div>
            <Coach
              game={game}
              index={index}
              move={move}
              evals={evals}
              before={scores[index - 1]}
              after={score}
              opening={opening}
              boardFen={view.fen}
              retry={retry}
              showBest={showBest}
              canRetry={canRetry}
              onBest={() => setShowBest((v) => !v)}
              onRetry={(status) => setRetry(status ? { status } : null)}
            />
            <p class="visually-hidden" aria-live="polite">
              {announcement}
            </p>
            <MoveList game={game} moves={moves} current={index} onSelect={go} />
            <nav class="controls" aria-label="Move navigation">
              <button type="button" onClick={() => go(0)} aria-label="First move" disabled={index === 0}>
                <NavIcon d="M7 6v12M18 6l-8 6 8 6z" />
              </button>
              <button type="button" onClick={() => go(index - 1)} aria-label="Previous move" disabled={index === 0}>
                <NavIcon d="M16 6l-8 6 8 6z" />
              </button>
              <button type="button" onClick={() => go(index + 1)} aria-label="Next move" disabled={index === total - 1}>
                <NavIcon d="M8 6l8 6-8 6z" />
              </button>
              <button type="button" onClick={() => go(total - 1)} aria-label="Last move" disabled={index === total - 1}>
                <NavIcon d="M17 6v12M6 6l8 6-8 6z" />
              </button>
              <button
                type="button"
                onClick={() => setOrientation((o) => (o === 'w' ? 'b' : 'w'))}
                aria-label="Flip board"
                title="Flip board (F)"
              >
                <NavIcon d="M7 4v14M4 15l3 3 3-3M17 20V6M14 9l3-3 3 3" stroke />
              </button>
              <button
                type="button"
                class="button-primary controls-next"
                onClick={() => nextKey !== undefined && go(nextKey)}
                disabled={nextKey === undefined}
                title="Next key move (N)"
              >
                {nextKey === undefined ? 'No more key moves' : 'Next key move'}
              </button>
            </nav>
          </>
        )}
      </aside>
    </div>
  );
}

export const NavIcon = ({ d, stroke }: { d: string; stroke?: boolean }) => (
  <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true">
    <path
      d={d}
      fill={stroke ? 'none' : 'currentColor'}
      stroke="currentColor"
      stroke-width={stroke ? 2 : 1.6}
      stroke-linecap="round"
      stroke-linejoin="round"
    />
  </svg>
);

/** Counts up from zero when a number first arrives, so the finished review lands as a moment. */
function useCountUp(target: number | undefined, ms = 750): number | undefined {
  const [value, setValue] = useState(() => (target === undefined || reducedMotion() ? target : 0));
  const key = target === undefined || Number.isNaN(target) ? undefined : target.toFixed(1);
  useEffect(() => {
    if (key === undefined || target === undefined || reducedMotion()) return setValue(target);
    let frame = 0;
    const start = performance.now();
    const step = (now: number) => {
      const t = Math.min(1, (now - start) / ms);
      setValue(target * (1 - (1 - t) ** 3));
      if (t < 1) frame = requestAnimationFrame(step);
    };
    frame = requestAnimationFrame(step);
    return () => cancelAnimationFrame(frame);
  }, [key]);
  return value;
}

const fmt = (x?: number) => (x === undefined || Number.isNaN(x) ? '—' : x.toFixed(1));

function PlayerStrip({ name, elo, accuracy, color }: { name: string; elo?: string; accuracy?: number; color: 'w' | 'b' }) {
  return (
    <div class={`player player-${color}`}>
      <Piece role="pawn" color={color === 'w' ? 'white' : 'black'} class="player-avatar" />
      <span class="player-name">{name}</span>
      {elo && elo !== '?' ? <span class="player-elo">{elo}</span> : null}
      {accuracy !== undefined && !Number.isNaN(accuracy) ? (
        <span class={`acc-chip acc-chip-${color} player-accuracy`} title="Accuracy">
          {fmt(accuracy)}
        </span>
      ) : null}
    </div>
  );
}

export function EvalBar({ score, orientation }: { score?: Score; orientation: 'w' | 'b' }) {
  const white = score?.whiteWin ?? 50;
  return (
    <div class={`evalbar ${orientation === 'b' ? 'evalbar-flipped' : ''}`} aria-label={score ? `Evaluation ${score.label}` : 'Evaluation pending'}>
      <div class="evalbar-white" style={`--white:${white / 100}`} />
      <span class="evalbar-mid" aria-hidden="true" />
      <span class={`evalbar-label ${white >= 50 ? 'evalbar-label-white' : 'evalbar-label-black'}`}>{score?.label.replace(/^[+-]/, '') ?? ''}</span>
    </div>
  );
}

function AccuracyChip({ value, color }: { value?: number; color: 'w' | 'b' }) {
  const shown = useCountUp(value);
  return (
    <span class={`acc-chip acc-chip-${color}`}>
      <span aria-hidden="true">{fmt(shown)}</span>
      <span class="visually-hidden">{fmt(value)}</span>
    </span>
  );
}

const PHASE_LABEL = { opening: 'Opening', middlegame: 'Middlegame', endgame: 'Endgame' } as const;

/** The report: chess.com's summary layout, with the counts doubling as jumps to those moves. */
function Report(props: {
  title: string;
  game: Game;
  moves: (MoveReview | undefined)[];
  accuracy?: { w: number; b: number };
  stats?: ReturnType<typeof playerStats>;
  summary?: string;
  names: { w: string; b: string };
  analysed: number;
  total: number;
  failure?: string;
  complete: boolean;
  rechecking: number;
  onRetry: () => void;
  onJump: (grade: Grade, color: 'w' | 'b') => void;
  onStart: () => void;
}) {
  const { title, game, moves, accuracy, stats, summary, names, analysed, total, failure, complete, rechecking, onRetry, onJump, onStart } = props;
  const counts = (grade: Grade, color: 'w' | 'b') => game.plies.filter((p, i) => p.color === color && moves[i]?.grade === grade).length;
  const count = (grade: Grade, color: 'w' | 'b') => {
    const n = counts(grade, color);
    return (
      <button type="button" disabled={!n} onClick={() => onJump(grade, color)} aria-label={`${n} ${grade} by ${names[color]}`}>
        <span class="count" key={n}>
          {n}
        </span>
      </button>
    );
  };
  const phaseIcon = (grade: Grade | null | undefined, phase: string, color: 'w' | 'b') =>
    grade ? (
      <span title={`${names[color]}: ${GRADE_INFO[grade].label.toLowerCase()} ${phase.toLowerCase()}`}>
        <GradeIcon grade={grade} solid />
        <span class="visually-hidden">{GRADE_INFO[grade].label}</span>
      </span>
    ) : (
      <span class="muted">—</span>
    );

  return (
    <section class="report" aria-label="Game review summary">
      <h2 class="report-title">Game Review</h2>
      <p class="report-game">{title}</p>
      {summary ? (
        <p class="report-coach">{summary}</p>
      ) : failure ? (
        <div class="report-failure" role="alert">
          <p>
            The review stopped at {analysed} of {total} positions: {failure}
          </p>
          <button type="button" class="button" onClick={onRetry}>
            Try again
          </button>
        </div>
      ) : complete ? (
        <p class="report-coach">Review complete. The game is too short for an accuracy score.</p>
      ) : (
        <div class="report-progress">
          <span class="report-label">{rechecking ? `Double-checking ${rechecking} positions deeper` : 'Reviewing on your device'}</span>
          <strong>
            {analysed}
            <span class="report-total"> / {total} positions</span>
          </strong>
          <span
            class="progress-bar"
            role="progressbar"
            aria-label="Positions analysed"
            aria-valuemin={0}
            aria-valuemax={total}
            aria-valuenow={analysed}
            data-running=""
            style={`--done:${analysed / total}`}
          />
        </div>
      )}
      <button type="button" class="button button-primary report-start" onClick={onStart}>
        Start review
      </button>
      <table class="report-table">
        <caption class="visually-hidden">Accuracy, moves by grade, and how each phase went. Select a count to jump to the next such move.</caption>
        <thead>
          <tr>
            <td />
            <th scope="col" class="report-name">
              <span class="player-swatch player-swatch-w" aria-hidden="true" />
              {names.w}
            </th>
            <td />
            <th scope="col" class="report-name">
              <span class="player-swatch player-swatch-b" aria-hidden="true" />
              {names.b}
            </th>
          </tr>
        </thead>
        <tbody>
          <tr class="report-accuracy">
            <th scope="row">Accuracy</th>
            <td>{accuracy ? <AccuracyChip value={accuracy.w} color="w" /> : <span class="acc-chip acc-chip-w">—</span>}</td>
            <td />
            <td>{accuracy ? <AccuracyChip value={accuracy.b} color="b" /> : <span class="acc-chip acc-chip-b">—</span>}</td>
          </tr>
        </tbody>
        <tbody class="report-grades">
          {GRADES.map((grade) => (
            <tr key={grade} class={counts(grade, 'w') + counts(grade, 'b') === 0 ? 'report-empty' : ''}>
              <th scope="row">{GRADE_INFO[grade].label}</th>
              <td>{count(grade, 'w')}</td>
              <td>
                <GradeIcon grade={grade} solid />
              </td>
              <td>{count(grade, 'b')}</td>
            </tr>
          ))}
        </tbody>
        <tbody class="report-stats">
          {PHASES.map((phase) => (
            <tr key={phase}>
              <th scope="row">{PHASE_LABEL[phase]}</th>
              <td>{phaseIcon(stats?.w.phases[phase], PHASE_LABEL[phase], 'w')}</td>
              <td />
              <td>{phaseIcon(stats?.b.phases[phase], PHASE_LABEL[phase], 'b')}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {analysed ? <p class="report-hint">Select a number to jump to those moves.</p> : null}
    </section>
  );
}

const TURNING: ReadonlySet<Grade> = new Set(['brilliant', 'great', 'miss', 'mistake', 'blunder']);

/** The few moves that decided the game: every brilliant move plus the biggest swings, in game order. */
function TurningPoints({ game, moves, current, onSelect }: { game: Game; moves: (MoveReview | undefined)[]; current: number; onSelect: (i: number) => void }) {
  const picks = moves
    .flatMap((m, i) => (m && TURNING.has(m.grade) ? [{ i, m }] : []))
    .sort((a, b) => (b.m.grade === 'brilliant' ? 100 : b.m.loss) - (a.m.grade === 'brilliant' ? 100 : a.m.loss))
    .slice(0, 5)
    .sort((a, b) => a.i - b.i);
  if (!picks.length) return null;
  return (
    <div class="turning">
      <span class="turning-label">Turning points</span>
      {picks.map(({ i, m }) => (
        <button
          key={i}
          type="button"
          class="turning-point"
          aria-current={current === i + 1 ? 'true' : undefined}
          onClick={() => onSelect(i + 1)}
          title={GRADE_INFO[m.grade].label}
        >
          <GradeIcon grade={m.grade} solid />
          <span class="san">{moveName(game, i)}</span>
        </button>
      ))}
    </div>
  );
}

/** The coach card: what the move was, why, and the chess.com-style Best / Retry actions. */
function Coach(props: {
  game: Game;
  index: number;
  move?: MoveReview;
  evals: (PositionEval | undefined)[];
  before?: Score;
  after?: Score;
  opening?: string;
  /** The position on the board, for Open on board. */
  boardFen: string;
  retry: Retry | null;
  showBest: boolean;
  canRetry: boolean;
  onBest: () => void;
  onRetry: (status: Retry['status'] | null) => void;
}) {
  const { game, index, move, evals, before, after, opening, boardFen, retry, showBest, canRetry, onBest, onRetry } = props;
  const ply = index > 0 ? game.plies[index - 1] : undefined;
  let grade: Grade | undefined = move?.grade;
  let lead: string;
  let detail: string | undefined;
  let actions = null;
  let line: string[] | undefined;

  if (!ply) {
    lead = opening ?? 'Starting position';
    detail = 'Step through the moves, or jump between key moments.';
  } else if (!move) {
    lead = moveName(game, index - 1);
    detail = 'Still analysing this move…';
  } else if (retry) {
    const side = SIDE[ply.color];
    const tried = retry.uci ? play(ply.fenBefore, retry.uci).san : undefined;
    if (retry.status === 'trying') {
      grade = undefined;
      lead = `Find a better move for ${side}.`;
      detail = `${moveName(game, index - 1)} was ${GRADE_INFO[move.grade].phrase}. Play your move on the board.`;
      actions = (
        <>
          <button type="button" class="button" onClick={() => onRetry('revealed')}>
            Show answer
          </button>
          <button type="button" class="link-button" onClick={() => onRetry(null)}>
            Cancel
          </button>
        </>
      );
    } else if (retry.status === 'checking') {
      grade = undefined;
      lead = `Checking ${tried}…`;
      detail = 'Stockfish is looking at your move.';
    } else if (retry.status === 'unchecked') {
      grade = undefined;
      lead = `Couldn't check ${tried}.`;
      detail = "Stockfish didn't answer. Try again, or see the answer.";
      actions = (
        <>
          <button type="button" class="button button-primary" onClick={() => onRetry('trying')}>
            Try again
          </button>
          <button type="button" class="button" onClick={() => onRetry('revealed')}>
            Show answer
          </button>
        </>
      );
    } else if (retry.status === 'correct') {
      grade = 'best';
      lead = `Correct! ${tried} ${tried === move.best ? 'is the best move' : 'works too'}.`;
      actions = (
        <button type="button" class="button" onClick={() => onRetry(null)}>
          Done
        </button>
      );
    } else if (retry.status === 'wrong') {
      grade = 'miss';
      lead = `${tried} isn't it.`;
      detail = 'Try again, or see the answer.';
      actions = (
        <>
          <button type="button" class="button button-primary" onClick={() => onRetry('trying')}>
            Try again
          </button>
          <button type="button" class="button" onClick={() => onRetry('revealed')}>
            Show answer
          </button>
        </>
      );
    } else {
      grade = 'best';
      lead = `The best move was ${move.best}.`;
      line = move.bestLine;
      actions = (
        <button type="button" class="button" onClick={() => onRetry(null)}>
          Done
        </button>
      );
    }
  } else {
    const winAfter = after ? (ply.color === 'w' ? after.whiteWin : 100 - after.whiteWin) : 50;
    ({ lead, detail } = explainMove(game, index - 1, move, evals, winAfter, opening));
    line = move.best ? move.bestLine : undefined;
    if (move.best || canRetry) {
      actions = (
        <>
          {move.best ? (
            <button type="button" class="button" aria-pressed={showBest} onClick={onBest}>
              <GradeIcon grade="best" /> Best
            </button>
          ) : null}
          {canRetry ? (
            <button type="button" class="button" onClick={() => onRetry('trying')}>
              Retry
            </button>
          ) : null}
        </>
      );
    }
  }

  return (
    <section class="coach" style={grade ? `--g:var(--g-${grade})` : undefined}>
      <Piece role="knight" color="white" class="coach-avatar" />
      <div class="coach-body" key={`${index}-${retry?.status ?? ''}`}>
        <p class="coach-lead">
          {grade ? <GradeIcon grade={grade} solid /> : null}
          <span>{lead}</span>
        </p>
        {detail ? <p class="coach-detail">{detail}</p> : null}
        {line && line.length ? (
          <p class="coach-line">
            <span class="coach-line-label">{retry ? 'Line' : 'Best'}</span> <strong class="san">{line[0]}</strong>
            {line.length > 1 ? <span class="san coach-line-rest"> {line.slice(1).join(' ')}</span> : null}
          </p>
        ) : null}
        {before && after && move && !retry && move.grade !== 'book' ? (
          <p class="coach-eval">
            {before.label} → {after.label}
          </p>
        ) : null}
      </div>
      <div class="coach-actions">
        {actions}
        {retry ? null : (
          <a class="button" href={boardHash(boardFen)} title="Explore this position with Stockfish">
            Open on board
          </a>
        )}
      </div>
    </section>
  );
}

function MoveList({ game, moves, current, onSelect }: { game: Game; moves: (MoveReview | undefined)[]; current: number; onSelect: (i: number) => void }) {
  const list = useRef<HTMLOListElement>(null);
  // Scroll the list itself, never the page: on phones the list sits below the board.
  useEffect(() => {
    const box = list.current;
    const row = box?.querySelector('[aria-current="true"]');
    if (!box || !row) return;
    const r = row.getBoundingClientRect();
    const b = box.getBoundingClientRect();
    const by = r.top < b.top ? r.top - b.top - 4 : r.bottom > b.bottom ? r.bottom - b.bottom + 4 : 0;
    if (by) box.scrollBy({ top: by });
  }, [current]);

  const cell = (i: number) => {
    const p = game.plies[i];
    if (!p) return <span class="move move-empty" />;
    const m = moves[i];
    return (
      <button
        type="button"
        class="move"
        aria-current={current === i + 1 ? 'true' : undefined}
        onClick={() => onSelect(i + 1)}
        style={m ? `--g:var(--g-${m.grade})` : undefined}
        title={m ? GRADE_INFO[m.grade].label : undefined}
      >
        {m && NOTABLE.has(m.grade) ? <GradeIcon grade={m.grade} solid /> : <span class="move-icon-gap" aria-hidden="true" />}
        <span class="san">{p.san}</span>
      </button>
    );
  };

  // Rows of full moves; a game starting with Black gets an empty White cell first.
  const offset = game.plies[0].color === 'b' ? 1 : 0;
  const rows = Math.ceil((game.plies.length + offset) / 2);
  return (
    <ol class="moves" ref={list} aria-label="Moves">
      {Array.from({ length: rows }, (_, r) => {
        const wi = r * 2 - offset;
        return (
          <li key={r}>
            <span class="moves-num">{game.plies[Math.max(0, wi)].moveNumber}.</span>
            {wi < 0 ? <span class="move move-empty" /> : cell(wi)}
            {cell(wi + 1)}
          </li>
        );
      })}
    </ol>
  );
}
