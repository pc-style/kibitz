import { Chess } from 'chess.js';
import type { ComponentChildren } from 'preact';
import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import { focusQuietly, useLater } from '../learn/ui';
import { useSettings } from '../settings';
import { play as sound } from '../sound';
import { Board } from '../ui/board';
import { hasSeen, markSeen, updateProgress, useProgress, type RushMode } from './progress';
import { PuzzlePool, type Puzzle } from './data';
import { afterSetup, PuzzleShell } from './shell';
import { useSolver } from './solver';

const MODES: { id: RushMode; label: string; detail: string }[] = [
  { id: '3', label: '3 min', detail: 'Three minutes on the clock.' },
  { id: '5', label: '5 min', detail: 'Five minutes on the clock.' },
  { id: 'survival', label: 'Survival', detail: 'No clock. Go until you miss three.' },
];
const STRIKES = 3;

/** Puzzle n of a run aims here: easy at first, a little harder with every one. */
const ladder = (n: number) => Math.min(2800, 650 + n * 55 + Math.round((Math.random() - 0.5) * 80));
/**
 * Early puzzles are short, so the first minute is quick wins; longer ones come in as they get harder. A rush is
 * about finding the win, so the endgames where you only hold a draw stay out of it.
 */
const shortEnough = (n: number) => (p: Puzzle) => p.moves.length <= (n < 8 ? 4 : n < 20 ? 6 : 8) && !p.themes.includes('equality');

interface Result {
  puzzle: Puzzle;
  ok: boolean;
}

export function RushPage({ mode: initial }: { mode?: RushMode }) {
  const [mode, setMode] = useState<RushMode>(initial ?? '3');
  const [run, setRun] = useState(0);
  const [over, setOver] = useState<{ results: Result[]; why: string; best: number; last?: Puzzle } | null>(null);

  if (over) return <RushOver mode={mode} {...over} onAgain={() => (setOver(null), setRun(run + 1))} onModes={() => (setOver(null), setRun(0))} />;
  if (run) return <RushRun key={run} mode={mode} onOver={setOver} />;
  return <RushStart mode={mode} onMode={setMode} onStart={() => setRun(run + 1)} />;
}

function RushStart({ mode, onMode, onStart }: { mode: RushMode; onMode: (m: RushMode) => void; onStart: () => void }) {
  const progress = useProgress();
  const settings = useSettings();
  return (
    <PuzzleShell
      title="Puzzle Rush"
      board={
        <div class="board puzzle-board">
          <Board fen={new Chess().fen()} orientation="white" shapes={[]} coordinates={settings.coordinates} animate={settings.motion} />
        </div>
      }
    >
      <div class="rush-intro">
        <p>Solve as many puzzles as you can. They start easy and get harder with every one. A wrong move is a miss, and three misses end the run.</p>
      </div>
      <div class="segmented segmented-wide" role="radiogroup" aria-label="Rush mode">
        {MODES.map((m) => (
          <button key={m.id} type="button" role="radio" aria-checked={mode === m.id} onClick={() => onMode(m.id)}>
            {m.label}
          </button>
        ))}
      </div>
      <p class="muted">{MODES.find((m) => m.id === mode)!.detail}</p>
      <button class="button button-primary rush-start" type="button" onClick={onStart} ref={focusQuietly}>
        Start
      </button>
      <dl class="rush-bests">
        {MODES.map((m) => (
          <div key={m.id}>
            <dt>{m.label}</dt>
            <dd>{progress.rush[m.id] || '—'}</dd>
          </div>
        ))}
      </dl>
      <p class="muted">Your best scores, kept in this browser.</p>
    </PuzzleShell>
  );
}

function RushRun({ mode, onOver }: { mode: RushMode; onOver: (o: { results: Result[]; why: string; best: number; last?: Puzzle }) => void }) {
  const pool = useMemo(() => new PuzzlePool({}), []);
  const used = useRef(new Set<string>());
  const [puzzle, setPuzzle] = useState<Puzzle | null>(null);
  const [results, setResults] = useState<Result[]>([]);
  const [started, setStarted] = useState<number | null>(null);
  const [now, setNow] = useState(Date.now());
  const [failed, setFailed] = useState(false);
  const upcoming = useRef<Promise<Puzzle | null> | null>(null);
  const finished = useRef(false);
  const warned = useRef(false);
  const limit = mode === 'survival' ? null : Number(mode) * 60_000;
  // Leaving the page ends the run quietly: nothing pending may play a sound, save a score or download more.
  const alive = useRef(true);
  const stop = useMemo(() => new AbortController(), []);
  const later = useLater();
  useEffect(
    () => () => {
      alive.current = false;
      stop.abort();
    },
    [],
  );

  const fetchNext = (n: number) => {
    const pick = pool.pick(ladder(n), (id) => used.current.has(id) || hasSeen(id), shortEnough(n), stop.signal).then((p) => {
      if (p) used.current.add(p.id);
      return p;
    });
    pick.catch(() => {});
    return pick;
  };

  const finish = (list: Result[], why: string) => {
    if (finished.current || !alive.current) return;
    finished.current = true;
    const score = list.filter((r) => r.ok).length;
    let best = 0;
    updateProgress((p) => {
      best = p.rush[mode];
      return score > best ? { rush: { ...p.rush, [mode]: score } } : {};
    });
    sound(score > best ? 'win' : 'draw');
    onOver({ results: list, why, best, last: list.at(-1)?.puzzle });
  };

  const advance = (list: Result[]) => {
    const next = upcoming.current ?? fetchNext(list.length);
    upcoming.current = null;
    next.then(
      (p) => {
        if (finished.current || !alive.current) return;
        if (!p) return finish(list, "That's every puzzle we have for a rush.");
        setPuzzle(p);
        setStarted((s) => s ?? Date.now());
        // While this one is solved, the next is found.
        upcoming.current = fetchNext(list.length + 1);
      },
      () => alive.current && setFailed(true),
    );
  };

  useEffect(() => {
    sound('start');
    advance([]);
  }, []);

  // The clock: ticks while the run lasts, and ends it at zero.
  useEffect(() => {
    if (!limit || started === null) return;
    const timer = setInterval(() => {
      const t = Date.now();
      setNow(t);
      const left = started + limit - t;
      if (left <= 10_000 && !warned.current) {
        warned.current = true;
        sound('lowtime');
      }
      if (left <= 0) finishRef.current();
    }, 100);
    return () => clearInterval(timer);
  }, [started]);
  const finishRef = useRef(() => {});
  finishRef.current = () => finish(results, "Time's up.");

  const onDone = (ok: boolean) => {
    if (!puzzle || finished.current) return;
    // Its answer is known now, so rated play shouldn't offer it again.
    markSeen(puzzle.id);
    // A move made after the clock ran out (before its next tick noticed) doesn't count.
    if (limit && started !== null && Date.now() >= started + limit) return finish(results, "Time's up.");
    const list = [...results, { puzzle, ok }];
    setResults(list);
    if (list.filter((r) => !r.ok).length >= STRIKES) return later(() => finish(list, 'Three misses.'), 900);
    later(() => !finished.current && advance(list), ok ? 350 : 900);
  };

  const left = limit && started !== null ? Math.max(0, started + limit - now) : limit;
  const misses = results.filter((r) => !r.ok).length;
  const score = results.length - misses;
  const status = (
    <div class="rush-status" aria-live="off">
      <div class="rush-score">
        <span>Solved</span>
        <strong key={score}>{score}</strong>
      </div>
      {left !== null ? (
        <div class={`rush-clock ${left <= 10_000 ? 'rush-clock-low' : ''}`}>
          <span>Time</span>
          <strong>{clock(left)}</strong>
        </div>
      ) : null}
      <ol class="rush-strikes" aria-label={`${misses} of ${STRIKES} misses`}>
        {Array.from({ length: STRIKES }, (_, i) => (
          <li key={i} class={i < misses ? 'strike-on' : ''} aria-hidden="true">
            ✗
          </li>
        ))}
      </ol>
    </div>
  );

  if (failed)
    return (
      <main class="notice">
        <h1>The puzzles didn't load</h1>
        <p>Check your connection, then start again.</p>
        <a class="button" href="#/puzzles">
          Back to Puzzles
        </a>
      </main>
    );
  if (!puzzle) return <PuzzleShell title="Puzzle Rush" board={<div class="board puzzle-board puzzle-board-empty" />} children={<>{status}<p class="muted">Finding puzzles…</p></>} />;
  return <RushPuzzle key={puzzle.id} puzzle={puzzle} status={status} results={results} onDone={onDone} onEnd={() => finish(results, 'You ended the run.')} />;
}

const clock = (ms: number) => {
  const s = Math.ceil(ms / 1000);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
};

function RushPuzzle(props: { puzzle: Puzzle; status: ComponentChildren; results: Result[]; onDone: (ok: boolean) => void; onEnd: () => void }) {
  const solver = useSolver(props.puzzle, { strict: true, onDone: props.onDone });
  const side = solver.color === 'white' ? 'White' : 'Black';
  const lead =
    solver.view.phase === 'failed' ? 'Missed.' : solver.view.phase === 'solved' ? 'Solved!' : solver.view.phase === 'intro' ? 'Next puzzle…' : `${side} to move.`;
  return (
    <PuzzleShell title="Puzzle Rush" board={solver.board}>
      {props.status}
      <p class={`rush-lead rush-lead-${solver.view.phase}`} key={lead}>
        {lead}
      </p>
      <RushTrail results={props.results} />
      <div class="lesson-actions">
        <button class="button" type="button" onClick={props.onEnd}>
          End run
        </button>
      </div>
    </PuzzleShell>
  );
}

function RushTrail({ results, links }: { results: Result[]; links?: boolean }) {
  if (!results.length) return null;
  return (
    <ol class="puzzle-strip rush-trail" aria-label="Puzzles this run">
      {results.map((r, i) => {
        const mark = (
          <>
            <span aria-hidden="true">{r.ok ? '✓' : '✗'}</span>
            <span class="rush-trail-rating">{r.puzzle.rating}</span>
            <span class="visually-hidden">{r.ok ? ' solved' : ' missed'}</span>
          </>
        );
        return (
          <li key={i}>
            {links ? (
              <a href={`#/puzzle/${r.puzzle.id}`} class={r.ok ? 'strip-ok' : 'strip-miss'}>
                {mark}
              </a>
            ) : (
              <span class={r.ok ? 'strip-ok' : 'strip-miss'}>{mark}</span>
            )}
          </li>
        );
      })}
    </ol>
  );
}

function RushOver({ mode, results, why, best, last, onAgain, onModes }: { mode: RushMode; results: Result[]; why: string; best: number; last?: Puzzle; onAgain: () => void; onModes: () => void }) {
  const settings = useSettings();
  const score = results.filter((r) => r.ok).length;
  const fen = last ? afterSetup(last) : new Chess().fen();
  const label = MODES.find((m) => m.id === mode)!.label;
  return (
    <PuzzleShell
      title="Puzzle Rush"
      board={
        <div class="board puzzle-board">
          <Board fen={fen} orientation={fen.split(' ')[1] === 'b' ? 'black' : 'white'} shapes={[]} coordinates={settings.coordinates} animate={settings.motion} />
        </div>
      }
    >
      <div class="rush-over">
        <p class="muted">{why}</p>
        <strong class="rush-final">{score}</strong>
        <p>
          {score > best ? (best ? `A new best for ${label}, up from ${best}!` : `Your first ${label} score.`) : `Your best for ${label} is ${best}.`}
        </p>
      </div>
      <div class="lesson-actions">
        <button class="button button-primary" type="button" onClick={onAgain} ref={focusQuietly}>
          Play again
        </button>
        <button class="button" type="button" onClick={onModes}>
          Change mode
        </button>
      </div>
      {results.length ? (
        <>
          <h2 class="rush-trail-title">Every puzzle this run</h2>
          <RushTrail results={results} links />
          <p class="muted">Open one to try it again, without the clock.</p>
        </>
      ) : null}
    </PuzzleShell>
  );
}
