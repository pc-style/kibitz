import type { DrawShape } from '@lichess-org/chessground/draw';
import type { Key } from '@lichess-org/chessground/types';
import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import { analysePositions, type PositionEval } from '../engine';
import { epd, parseGame, type Game } from '../game';
import { GRADES, gameAccuracy, reviewGame, type Grade, type MoveReview, type Score } from '../review';
import { Board } from './board';
import { EvalGraph } from './graph';
import { GRADE_INFO, NOTABLE, badgeSvg } from './grades';

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
  const [evals, setEvals] = useState<(PositionEval | undefined)[]>([]);
  const [failure, setFailure] = useState<string>();
  const [index, setIndex] = useState(0);
  const [orientation, setOrientation] = useState(initialOrientation);
  const [openings, setOpenings] = useState<Openings | null>(null);

  useEffect(() => {
    import('../openings.json').then((m) => setOpenings({ book: new Set(m.default.book), names: m.default.names as Record<string, string> }));
  }, []);

  useEffect(() => {
    const key = cacheKey(game, depth);
    const cached = localStorage.getItem(key);
    if (cached) {
      setEvals(JSON.parse(cached));
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

  const go = (i: number) => setIndex(Math.max(0, Math.min(total - 1, i)));
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
    <div class="review">
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
        <div class="progress" role="status" aria-live="polite">
          {failure ? (
            <span class="progress-error">Engine stopped: {failure}</span>
          ) : complete ? (
            <span>
              Reviewed at depth {depth} with Stockfish 19 on your device. Arrow keys step through moves, F flips the board.
            </span>
          ) : (
            <>
              <span>
                Analysing on your device · {analysed} of {total} positions
              </span>
              <span class="progress-bar" style={`--done:${analysed / total}`} />
            </>
          )}
        </div>
      </section>

      <aside class="panel">
        <Summary moves={moves} game={game} accuracy={accuracy} onJump={jumpTo} complete={complete} />
        <Comment game={game} index={index} move={move} before={scores[index - 1]} after={score} opening={opening} />
        <MoveList game={game} moves={moves} current={index} onSelect={go} />
        <nav class="controls" aria-label="Move navigation">
          <button type="button" onClick={() => go(0)} aria-label="First move">
            ⏮
          </button>
          <button type="button" onClick={() => go(index - 1)} aria-label="Previous move">
            ◀
          </button>
          <button type="button" onClick={() => go(index + 1)} aria-label="Next move">
            ▶
          </button>
          <button type="button" onClick={() => go(total - 1)} aria-label="Last move">
            ⏭
          </button>
          <button type="button" class="controls-flip" onClick={() => setOrientation((o) => (o === 'w' ? 'b' : 'w'))}>
            Flip board
          </button>
        </nav>
      </aside>
    </div>
  );
}

function PlayerStrip({ name, elo, accuracy, color }: { name: string; elo?: string; accuracy?: number; color: 'w' | 'b' }) {
  return (
    <div class="player">
      <span class={`player-swatch player-swatch-${color}`} aria-hidden="true" />
      <span class="player-name">{name}</span>
      {elo && elo !== '?' ? <span class="player-elo">{elo}</span> : null}
      <span class="player-accuracy" title="Accuracy">
        {accuracy !== undefined && !Number.isNaN(accuracy) ? accuracy.toFixed(1) : ''}
      </span>
    </div>
  );
}

function EvalBar({ score, orientation }: { score?: Score; orientation: 'w' | 'b' }) {
  const white = score?.whiteWin ?? 50;
  return (
    <div class={`evalbar ${orientation === 'b' ? 'evalbar-flipped' : ''}`} aria-label={score ? `Evaluation ${score.label}` : 'Evaluation pending'}>
      <div class="evalbar-white" style={`--white:${white / 100}`} />
      <span class={`evalbar-label ${white >= 50 ? 'evalbar-label-white' : 'evalbar-label-black'}`}>{score?.label ?? '…'}</span>
    </div>
  );
}

function Summary(props: {
  moves: (MoveReview | undefined)[];
  game: Game;
  accuracy?: { w: number; b: number };
  complete: boolean;
  onJump: (grade: Grade, color: 'w' | 'b') => void;
}) {
  const { moves, game, accuracy, onJump } = props;
  const counts = (grade: Grade, color: 'w' | 'b') => game.plies.filter((p, i) => p.color === color && moves[i]?.grade === grade).length;
  const fmt = (x?: number) => (x === undefined || Number.isNaN(x) ? '—' : x.toFixed(1));

  return (
    <section class="summary" aria-label="Game summary">
      <div class="summary-accuracy">
        <div>
          <span class="summary-label">White accuracy</span>
          <strong>{fmt(accuracy?.w)}</strong>
        </div>
        <div>
          <span class="summary-label">Black accuracy</span>
          <strong>{fmt(accuracy?.b)}</strong>
        </div>
      </div>
      <table class="grades">
        <caption class="visually-hidden">Moves by grade. Select a count to jump to the next such move.</caption>
        <thead>
          <tr>
            <th scope="col">White</th>
            <th scope="col">
              <span class="visually-hidden">Grade</span>
            </th>
            <th scope="col">Black</th>
          </tr>
        </thead>
        <tbody>
          {GRADES.map((grade) => {
            const w = counts(grade, 'w');
            const b = counts(grade, 'b');
            return (
              <tr key={grade} class={w + b === 0 ? 'grades-empty' : ''}>
                <td>
                  <button type="button" disabled={!w} onClick={() => onJump(grade, 'w')} aria-label={`${w} white ${grade}`}>
                    {w}
                  </button>
                </td>
                <th scope="row">
                  <span class="glyph" style={`--g:var(--g-${grade})`} aria-hidden="true">
                    {GRADE_INFO[grade].glyph}
                  </span>
                  {GRADE_INFO[grade].label}
                </th>
                <td>
                  <button type="button" disabled={!b} onClick={() => onJump(grade, 'b')} aria-label={`${b} black ${grade}`}>
                    {b}
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

function Comment(props: { game: Game; index: number; move?: MoveReview; before?: Score; after?: Score; opening?: string }) {
  const { game, index, move, before, after, opening } = props;
  if (index === 0) {
    return (
      <section class="comment">
        <p class="comment-lead">{opening ?? 'Starting position'}</p>
        <p class="comment-detail">Step through the game to see how each move was graded.</p>
      </section>
    );
  }
  const name = moveName(game, index - 1);
  if (!move) {
    return (
      <section class="comment">
        <p class="comment-lead">{name}</p>
        <p class="comment-detail">Still analysing this move…</p>
      </section>
    );
  }
  const info = GRADE_INFO[move.grade];
  return (
    <section class="comment" style={`--g:var(--g-${move.grade})`}>
      <p class="comment-lead">
        <span class="glyph glyph-solid" aria-hidden="true">
          {info.glyph}
        </span>
        <strong>{name}</strong> is {info.phrase}.
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
    </section>
  );
}

function MoveList({ game, moves, current, onSelect }: { game: Game; moves: (MoveReview | undefined)[]; current: number; onSelect: (i: number) => void }) {
  const list = useRef<HTMLOListElement>(null);
  useEffect(() => {
    list.current?.querySelector('[aria-current="true"]')?.scrollIntoView({ block: 'nearest' });
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
        {m && NOTABLE.has(m.grade) ? <span class="move-glyph">{GRADE_INFO[m.grade].glyph}</span> : m ? <span class="move-dot" aria-hidden="true" /> : null}
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
