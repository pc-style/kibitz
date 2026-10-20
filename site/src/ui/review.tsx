import type { DrawShape } from '@lichess-org/chessground/draw';
import type { Key } from '@lichess-org/chessground/types';
import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import { analysePositions, type PositionEval } from '../engine';
import { epd, parseGame, type Game } from '../game';
import { GRADES, gameAccuracy, reviewGame, type Grade, type MoveReview, type Score } from '../review';
import { Board } from './board';
import { EvalGraph } from './graph';
import { GRADE_INFO, GradeIcon, NOTABLE, badgeSvg } from './grades';
import { ThemePicker, reducedMotion } from './theme';

const DEPTHS = [
  { depth: 12, label: 'Quick' },
  { depth: 16, label: 'Standard' },
  { depth: 20, label: 'Deep' },
];

interface Openings {
  book: Set<string>;
  names: Record<string, string>;
}

function cacheKey(game: Game, depth: number): string {
  let h = 0x811c9dc5;
  for (const ch of game.fens.join('|')) h = Math.imul(h ^ ch.charCodeAt(0), 0x01000193) >>> 0;
  return `kibitz:v1:${depth}:${h.toString(36)}`;
}

function readCache(key: string): (PositionEval | undefined)[] | null {
  const cached = localStorage.getItem(key);
  return cached ? JSON.parse(cached) : null;
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
        <a class="button" href="#">
          Back to start
        </a>
      </main>
    );
  }
  return <Reviewer game={parsed.game} initialOrientation={initialOrientation} />;
}

function Reviewer({ game, initialOrientation }: { game: Game; initialOrientation: 'w' | 'b' }) {
  const total = game.fens.length;
  const [depth, setDepth] = useState(() => Number(localStorage.getItem('kibitz:depth')) || 16);
  // Read a saved review synchronously so a revisit renders complete on the first frame.
  const [evals, setEvals] = useState<(PositionEval | undefined)[]>(() => readCache(cacheKey(game, depth)) ?? []);
  const [failure, setFailure] = useState<string>();
  const [index, setIndex] = useState(0);
  const [orientation, setOrientation] = useState(initialOrientation);
  const [openings, setOpenings] = useState<Openings | null>(null);

  useEffect(() => {
    import('../openings.json').then((m) => setOpenings({ book: new Set(m.default.book), names: m.default.names as Record<string, string> }));
  }, []);

  useEffect(() => {
    const key = cacheKey(game, depth);
    const cached = readCache(key);
    if (cached) {
      setEvals(cached);
      return;
    }
    const result: (PositionEval | undefined)[] = [];
    setEvals([]);
    setFailure(undefined);
    const ctrl = new AbortController();
    const fens = game.fens.map((fen, i) => (i === total - 1 && game.ending ? null : fen));
    analysePositions(
      fens,
      depth,
      (i, ev) => {
        result[i] = ev;
        setEvals([...result]);
      },
      ctrl.signal,
    )
      .then(() => {
        if (ctrl.signal.aborted) return;
        try {
          localStorage.setItem(key, JSON.stringify(result));
        } catch {
          // Storage full: the review still works, it just won't be remembered.
        }
      })
      .catch((err) => setFailure(err instanceof Error ? err.message : String(err)));
    return () => ctrl.abort();
  }, [game, depth]);

  const { scores, moves } = useMemo(() => reviewGame(game, evals, openings?.book ?? null), [game, evals, openings]);
  const analysed = scores.filter(Boolean).length;
  const complete = analysed === total;
  const accuracy = useMemo(
    () => (complete ? gameAccuracy(scores as Score[], game.plies[0].color === 'w') : undefined),
    [complete, scores],
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
    setIndex(Math.max(0, Math.min(total - 1, i)));
  };
  const indexRef = useRef(index);
  indexRef.current = index;

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLSelectElement || e.metaKey || e.ctrlKey) return;
      const i = indexRef.current;
      const map: Record<string, number> = { ArrowLeft: i - 1, ArrowRight: i + 1, ArrowUp: 0, Home: 0, ArrowDown: total - 1, End: total - 1 };
      if (e.key in map) {
        e.preventDefault();
        go(map[e.key]);
      } else if (e.key === 'f') setOrientation((o) => (o === 'w' ? 'b' : 'w'));
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [total]);

  const ply = index > 0 ? game.plies[index - 1] : undefined;
  const move = index > 0 ? moves[index - 1] : undefined;
  const shapes = useMemo<DrawShape[]>(() => {
    if (!ply || !move) return [];
    const out: DrawShape[] = [{ orig: ply.to, customSvg: { html: badgeSvg(move.grade) } }];
    const best = evals[index - 1]?.lines[0]?.pv[0];
    if (move.best && best) out.push({ orig: best.slice(0, 2) as Key, dest: best.slice(2, 4) as Key, brush: 'best' });
    return out;
  }, [ply, move, evals, index]);

  // One short announcement once stepping pauses, instead of re-reading the comment card on every move.
  const [announcement, setAnnouncement] = useState('');
  useEffect(() => {
    const text = !ply
      ? 'Starting position'
      : `${moveName(game, index - 1)}${move ? `, ${GRADE_INFO[move.grade].label.toLowerCase()}${move.best ? `. Best was ${move.best}` : ''}` : ''}`;
    const timer = setTimeout(() => setAnnouncement(text), 400);
    return () => clearTimeout(timer);
  }, [index, move?.grade, move?.best]);

  const opening = useMemo(() => {
    if (!openings) return game.headers.Opening;
    let name = game.headers.Opening;
    for (let i = 0; i < Math.min(index, game.plies.length); i++) name = openings.names[epd(game.plies[i].fenAfter)] ?? name;
    return name;
  }, [openings, index, game]);

  const jumpTo = (grade: Grade, color: 'w' | 'b') => {
    const hits = game.plies.flatMap((p, i) => (p.color === color && moves[i]?.grade === grade ? [i + 1] : []));
    if (hits.length) go(hits.find((h) => h > index) ?? hits[0]);
  };

  const h = game.headers;
  const player = (c: 'w' | 'b') => ({
    name: (c === 'w' ? h.White : h.Black) || (c === 'w' ? 'White' : 'Black'),
    elo: c === 'w' ? h.WhiteElo : h.BlackElo,
    accuracy: accuracy?.[c],
  });
  const top = orientation === 'w' ? 'b' : 'w';
  const bottom = orientation;
  const score = scores[index];

  return (
    <div class="review" ref={root}>
      <header class="topbar">
        <a class="wordmark" href="#" aria-label="Kibitz home">
          kibitz
        </a>
        <p class="topbar-game">
          {player('w').name} vs {player('b').name}
          {h.Result && h.Result !== '*' ? ` · ${h.Result.replace('1/2-1/2', '½-½')}` : ''}
          {h.Date && !h.Date.includes('?') ? ` · ${h.Date.replaceAll('.', '-')}` : ''}
        </p>
        <label class="depth">
          <span>Engine depth</span>
          <select
            value={depth}
            onChange={(e) => {
              const d = Number((e.target as HTMLSelectElement).value);
              localStorage.setItem('kibitz:depth', String(d));
              setDepth(d);
            }}
          >
            {DEPTHS.map((d) => (
              <option value={d.depth}>
                {d.label} · {d.depth}
              </option>
            ))}
          </select>
        </label>
        <ThemePicker />
      </header>

      <section class="stage">
        <PlayerStrip {...player(top)} color={top} />
        <div class="board-row">
          <EvalBar score={score} orientation={orientation} />
          <div class="board">
            <Board
              fen={game.fens[index]}
              orientation={orientation === 'w' ? 'white' : 'black'}
              lastMove={ply ? [ply.from, ply.to] : undefined}
              shapes={shapes}
            />
          </div>
        </div>
        <PlayerStrip {...player(bottom)} color={bottom} />
        <EvalGraph scores={scores} moves={moves} current={index} onSelect={go} />
        {complete ? <TurningPoints game={game} moves={moves} current={index} onSelect={go} /> : null}
        <p class="progress" role="status">
          {failure ? (
            <span class="progress-error">Engine stopped: {failure}</span>
          ) : complete ? (
            `Reviewed at depth ${depth} with Stockfish 19 on your device. Arrow keys step through moves, F flips the board.`
          ) : (
            'Stockfish is running in this tab. Moves get graded as their positions finish.'
          )}
        </p>
      </section>

      <aside class="panel">
        <Summary
          moves={moves}
          game={game}
          accuracy={accuracy}
          names={{ w: player('w').name, b: player('b').name }}
          analysed={analysed}
          total={total}
          running={!failure}
          onJump={jumpTo}
        />
        <Comment game={game} index={index} move={move} before={scores[index - 1]} after={score} opening={opening} />
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
          <button type="button" class="controls-flip" onClick={() => setOrientation((o) => (o === 'w' ? 'b' : 'w'))}>
            Flip board
          </button>
        </nav>
      </aside>
    </div>
  );
}

const NavIcon = ({ d }: { d: string }) => (
  <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true">
    <path d={d} fill="currentColor" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round" />
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
    <div class="player">
      <span class={`player-swatch player-swatch-${color}`} aria-hidden="true" />
      <span class="player-name">{name}</span>
      {elo && elo !== '?' ? <span class="player-elo">{elo}</span> : null}
      <span class="player-accuracy" title="Accuracy">
        {accuracy !== undefined && !Number.isNaN(accuracy) ? fmt(accuracy) : ''}
      </span>
    </div>
  );
}

function EvalBar({ score, orientation }: { score?: Score; orientation: 'w' | 'b' }) {
  const white = score?.whiteWin ?? 50;
  return (
    <div class={`evalbar ${orientation === 'b' ? 'evalbar-flipped' : ''}`} aria-label={score ? `Evaluation ${score.label}` : 'Evaluation pending'}>
      <div class="evalbar-white" style={`--white:${white / 100}`} />
      <span class="evalbar-mid" aria-hidden="true" />
      <span class={`evalbar-label ${white >= 50 ? 'evalbar-label-white' : 'evalbar-label-black'}`}>{score?.label.replace(/^[+-]/, '') ?? ''}</span>
    </div>
  );
}

function Accuracy({ name, value, align }: { name: string; value?: number; align: 'start' | 'end' }) {
  const shown = useCountUp(value);
  return (
    <div class={`accuracy accuracy-${align}`}>
      <span class="summary-label">{name}</span>
      <strong aria-hidden="true">{fmt(shown)}</strong>
      <span class="visually-hidden">{fmt(value)}</span>
    </div>
  );
}

function Summary(props: {
  moves: (MoveReview | undefined)[];
  game: Game;
  accuracy?: { w: number; b: number };
  names: { w: string; b: string };
  analysed: number;
  total: number;
  running: boolean;
  onJump: (grade: Grade, color: 'w' | 'b') => void;
}) {
  const { moves, game, accuracy, names, analysed, total, running, onJump } = props;
  const counts = (grade: Grade, color: 'w' | 'b') => game.plies.filter((p, i) => p.color === color && moves[i]?.grade === grade).length;

  return (
    <section class="summary" aria-label="Game summary">
      {accuracy ? (
        <div class="summary-accuracy">
          <Accuracy name={names.w} value={accuracy.w} align="start" />
          <span class="summary-label summary-accuracy-title">Accuracy</span>
          <Accuracy name={names.b} value={accuracy.b} align="end" />
        </div>
      ) : (
        <div class="summary-progress">
          <span class="summary-label">Reviewing on your device</span>
          <strong>
            {analysed}
            <span class="summary-total"> / {total} positions</span>
          </strong>
          <span
            class="progress-bar"
            role="progressbar"
            aria-label="Positions analysed"
            aria-valuemin={0}
            aria-valuemax={total}
            aria-valuenow={analysed}
            data-running={running ? '' : undefined}
            style={`--done:${analysed / total}`}
          />
        </div>
      )}
      <table class="grades">
        <caption class="visually-hidden">Moves by grade. Select a count to jump to the next such move.</caption>
        <thead class="visually-hidden">
          <tr>
            <th scope="col">{names.w}</th>
            <th scope="col">Grade</th>
            <th scope="col">{names.b}</th>
          </tr>
        </thead>
        <tbody>
          {GRADES.map((grade) => {
            const w = counts(grade, 'w');
            const b = counts(grade, 'b');
            return (
              <tr key={grade} class={w + b === 0 ? 'grades-empty' : ''}>
                <td>
                  <button type="button" disabled={!w} onClick={() => onJump(grade, 'w')} aria-label={`${w} ${grade} by ${names.w}`}>
                    <span class="count" key={w}>
                      {w}
                    </span>
                  </button>
                </td>
                <th scope="row">
                  <GradeIcon grade={grade} />
                  {GRADE_INFO[grade].label}
                </th>
                <td>
                  <button type="button" disabled={!b} onClick={() => onJump(grade, 'b')} aria-label={`${b} ${grade} by ${names.b}`}>
                    <span class="count" key={b}>
                      {b}
                    </span>
                  </button>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </section>
  );
}

function moveName(game: Game, i: number) {
  const p = game.plies[i];
  return `${p.moveNumber}${p.color === 'w' ? '.' : '…'} ${p.san}`;
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
          <GradeIcon grade={m.grade} />
          <span class="san">{moveName(game, i)}</span>
        </button>
      ))}
    </div>
  );
}

function Comment(props: { game: Game; index: number; move?: MoveReview; before?: Score; after?: Score; opening?: string }) {
  const { game, index, move, before, after, opening } = props;
  const tint = move ? `--g:var(--g-${move.grade})` : undefined;
  let body;
  if (index === 0) {
    body = (
      <>
        <p class="comment-lead">{opening ?? 'Starting position'}</p>
        <p class="comment-detail">Step through the game to see how each move was graded.</p>
      </>
    );
  } else if (!move) {
    body = (
      <>
        <p class="comment-lead">
          <strong>{moveName(game, index - 1)}</strong>
        </p>
        <p class="comment-detail">Still analysing this move…</p>
      </>
    );
  } else {
    body = (
      <>
        <p class="comment-lead">
          <GradeIcon grade={move.grade} solid />
          <span>
            <strong>{moveName(game, index - 1)}</strong> is {GRADE_INFO[move.grade].phrase}.
          </span>
        </p>
        {move.grade === 'book' && opening ? <p class="comment-detail">{opening}</p> : null}
        {move.best ? (
          <p class="comment-detail">
            {move.grade === 'miss' ? 'You had ' : 'Best was '}
            <strong class="san">{move.best}</strong>
            {move.bestLine && move.bestLine.length > 1 ? <span class="comment-line"> {move.bestLine.slice(1).join(' ')}</span> : null}
          </p>
        ) : null}
        {before && after && move.grade !== 'book' ? (
          <p class="comment-eval">
            {before.label} → {after.label}
          </p>
        ) : null}
      </>
    );
  }
  return (
    <section class="comment" style={tint}>
      <div class="comment-body" key={index}>
        {body}
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
        <span class="san">{p.san}</span>
        {m && NOTABLE.has(m.grade) ? <GradeIcon grade={m.grade} /> : m ? <span class="move-dot" aria-hidden="true" /> : null}
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
            <span class="moves-num">{game.plies[Math.max(0, wi)].moveNumber}</span>
            {wi < 0 ? <span class="move move-empty" /> : cell(wi)}
            {cell(wi + 1)}
          </li>
        );
      })}
    </ol>
  );
}
