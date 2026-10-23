import type { ComponentChildren } from 'preact';
import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import { Coach, focusQuietly, type Tone } from '../learn/ui';
import { boardHash, reviewHash } from '../sources';
import { Board } from '../ui/board';
import { Piece } from '../ui/piece';
import { useSettings } from '../settings';
import { botGame, dailyPuzzle, filterSize, findPuzzle, ORIGINAL_COUNT, PUZZLE_COUNT, PuzzlePool, today, type Filter, type Puzzle } from './data';
import { MistakesPage, useMistakes } from './mistakes';
import { getProgress, hasSeen, LEVELS, markSeen, rate, startAt, updateProgress, useProgress, type Attempt, type PuzzleProgress, type RushMode } from './progress';
import { RushPage } from './rush';
import { afterSetup, Missing, PuzzleShell } from './shell';
import { useSolver, type Solver } from './solver';
import { shownThemes, THEME_GROUPS, THEMES, themeLabel } from './themes';
import './puzzles.css';

export type PuzzleRoute =
  | { view: 'hub' }
  | { view: 'rated'; filter: Filter }
  | { view: 'daily' }
  | { view: 'rush'; mode?: RushMode }
  | { view: 'mistakes' }
  | { view: 'one'; id: string };

/** #/puzzles, #/puzzles/rated, #/puzzles/theme/<theme>, #/puzzles/originals, #/puzzles/daily, #/puzzles/rush, #/puzzles/mistakes, #/puzzle/<id>. */
export function readPuzzleRoute(section: string, id?: string, sub?: string): PuzzleRoute {
  if (section === 'puzzle' && id) return { view: 'one', id };
  if (id === 'rated') return { view: 'rated', filter: {} };
  if (id === 'theme' && sub) return { view: 'rated', filter: { theme: sub } };
  if (id === 'originals') return { view: 'rated', filter: { source: 'kibitz' } };
  if (id === 'daily') return { view: 'daily' };
  if (id === 'rush') return { view: 'rush', mode: sub === '3' || sub === '5' || sub === 'survival' ? sub : undefined };
  if (id === 'mistakes') return { view: 'mistakes' };
  return { view: 'hub' };
}

export function puzzleTitle(route: PuzzleRoute): string {
  switch (route.view) {
    case 'rated':
      return route.filter.theme ? `${themeLabel(route.filter.theme)} puzzles` : route.filter.source ? 'Kibitz originals' : 'Rated puzzles';
    case 'daily':
      return 'Puzzle of the day';
    case 'rush':
      return 'Puzzle Rush';
    case 'mistakes':
      return 'Your mistakes';
    case 'one':
      return `Puzzle ${route.id}`;
    default:
      return 'Puzzles';
  }
}

export function PuzzlesPage({ route }: { route: PuzzleRoute }) {
  switch (route.view) {
    case 'rated':
      return <Trainer filter={route.filter} />;
    case 'daily':
      return <Daily />;
    case 'rush':
      return <RushPage mode={route.mode} />;
    case 'mistakes':
      return <MistakesPage />;
    case 'one':
      return <SinglePuzzle id={route.id} />;
    default:
      return <Hub />;
  }
}

// ---------------------------------------------------------------- layout

const SIDE = { white: 'White', black: 'Black' } as const;

/** What the coach says at each point of a puzzle. */
function verdictOf(s: Solver, extra?: { solved?: string; failed?: string }): { tone: Tone; lead: string; detail?: string } {
  const side = SIDE[s.color];
  // Some endgame puzzles are about holding the draw, not winning.
  const goal = s.saving ? `the move that saves the game for ${side}` : `the best move for ${side}`;
  switch (s.view.phase) {
    case 'intro':
      return { tone: 'neutral', lead: `You play ${side}.`, detail: 'Watch the last move.' };
    case 'reply':
      return { tone: 'good', lead: 'Best move!', detail: 'Keep going.' };
    case 'wrong':
      return { tone: 'bad', lead: 'Not that one.', detail: extra?.failed ?? 'Try another move.' };
    case 'failed':
      return { tone: 'bad', lead: 'Not this one.' };
    case 'shown':
      return { tone: 'neutral', lead: "That's the solution.", detail: extra?.failed };
    case 'solved':
      return s.failed ? { tone: 'good', lead: 'Solved, with help.', detail: extra?.failed } : { tone: 'good', lead: 'Solved!', detail: extra?.solved };
    default:
      if (s.view.ply > 1) return { tone: 'good', lead: 'Best move! Keep going.', detail: `Find the next move for ${side}.` };
      return s.failed ? { tone: 'neutral', lead: 'Try again.', detail: `Find ${goal}.` } : { tone: 'neutral', lead: 'Your turn.', detail: `Find ${goal}.` };
  }
}

function SolveActions({ solver, next }: { solver: Solver; next?: { label: string; onClick: () => void; disabled?: boolean } }) {
  if (solver.done) {
    return (
      <div class="lesson-actions">
        {next ? (
          <button class="button button-primary" type="button" onClick={next.onClick} disabled={next.disabled} ref={focusQuietly}>
            {next.label}
          </button>
        ) : null}
        <button class="button" type="button" onClick={solver.retry}>
          Retry
        </button>
      </div>
    );
  }
  const playing = solver.view.phase === 'play';
  return (
    <div class="lesson-actions">
      <button class="button" type="button" onClick={solver.hint} disabled={!playing || solver.hints >= 2}>
        {solver.hints ? 'Show the move' : 'Hint'}
      </button>
      <button class="button" type="button" onClick={solver.showSolution} disabled={!playing}>
        View solution
      </button>
    </div>
  );
}

/** After a puzzle: its rating, themes and where it came from, a way to analyse it, and its own link. */
function PuzzleInfo({ puzzle }: { puzzle: Puzzle }) {
  const themes = shownThemes(puzzle.themes);
  return (
    <div class="puzzle-info">
      <p>
        <a href={`#/puzzle/${puzzle.id}`}>Puzzle {puzzle.id}</a> · rated <strong>{puzzle.rating}</strong>
      </p>
      {themes.length ? (
        <ul class="puzzle-tags" aria-label="Themes">
          {themes.map((t) => (
            <li key={t}>
              <a href={`#/puzzles/theme/${t}`}>{themeLabel(t)}</a>
            </li>
          ))}
        </ul>
      ) : null}
      <p class="muted">
        <SourceLine puzzle={puzzle} />
      </p>
      <p>
        <a href={analysisLink(puzzle)}>Analyse this position →</a>
      </p>
    </div>
  );
}

/** The analysis board at the puzzle's start: after the opponent's move, your turn. */
const analysisLink = (puzzle: Puzzle) => boardHash(afterSetup(puzzle));

function SourceLine({ puzzle }: { puzzle: Puzzle }) {
  const s = puzzle.source;
  switch (s.kind) {
    case 'lichess':
      return (
        <>
          From a game played on lichess.{' '}
          <a href={`https://lichess.org/${s.game}`} target="_blank" rel="noopener noreferrer">
            See the game ↗
          </a>
        </>
      );
    case 'bots':
      return (
        <>
          A Kibitz original, from a game {s.white === s.black ? `${s.white} played against itself` : `between ${s.white} and ${s.black}`} (
          <a href="#/play">Kibitz bots</a>).{' '}
          <GameLink puzzle={puzzle} white={s.white} black={s.black} />
        </>
      );
    case 'tablebase':
      return <>A Kibitz original: an endgame ({s.material.replace('v', ' vs ')}) proven move by move with a tablebase.</>;
    default:
      return <>A Kibitz original.</>;
  }
}

/** Opens the bot game a puzzle came from in the review, up to the move that set the puzzle. */
function GameLink({ puzzle, white, black }: { puzzle: Puzzle; white: string; black: string }) {
  const [state, setState] = useState<'idle' | 'loading' | 'failed'>('idle');
  // A download that finishes after you've moved on mustn't pull you back into a review.
  const alive = useRef(true);
  useEffect(
    () => () => {
      alive.current = false;
    },
    [],
  );
  const open = () => {
    setState('loading');
    botGame(puzzle.id).then(
      (moves) => {
        if (!alive.current) return;
        if (!moves) return setState('failed');
        const pgn = `[Event "Kibitz bot game"]\n[White "${white}"]\n[Black "${black}"]\n[Result "*"]\n\n${moves} *`;
        location.hash = reviewHash(pgn, afterSetup(puzzle).split(' ')[1] === 'b' ? 'b' : 'w');
      },
      () => alive.current && setState('failed'),
    );
  };
  if (state === 'failed') return <span>The game didn't load.</span>;
  return (
    <button type="button" class="link-button puzzle-game-link" onClick={open} disabled={state === 'loading'}>
      {state === 'loading' ? 'Opening the game…' : 'See the game →'}
    </button>
  );
}

/** The last puzzles played, as ticks and crosses; each opens that puzzle again. */
function SessionStrip({ attempts }: { attempts: Attempt[] }) {
  if (!attempts.length) return null;
  return (
    <ol class="puzzle-strip" aria-label="Recent puzzles">
      {attempts.slice(-20).map((a, i) => (
        <li key={`${a.id}-${i}`}>
          <a
            href={`#/puzzle/${a.id}`}
            class={a.ok ? 'strip-ok' : 'strip-miss'}
            title={`${a.ok ? 'Solved' : 'Missed'} · rated ${a.rating}${a.delta ? ` · ${a.delta > 0 ? '+' : ''}${a.delta}` : ''}`}
          >
            <span aria-hidden="true">{a.ok ? '✓' : '✗'}</span>
            <span class="visually-hidden">
              {a.ok ? 'Solved' : 'Missed'}, rated {a.rating}
            </span>
          </a>
        </li>
      ))}
    </ol>
  );
}

// ---------------------------------------------------------------- rated puzzles

const DIFFICULTY = [
  { value: -1, label: 'Easier' },
  { value: 0, label: 'Normal' },
  { value: 1, label: 'Harder' },
] as const;
/** How far Easier and Harder aim from your rating. */
const STEP = 300;

function Trainer({ filter }: { filter: Filter }) {
  const progress = useProgress();
  const title = puzzleTitle({ view: 'rated', filter });
  if (filter.theme && !THEMES[filter.theme] && !filterSize(filter)) return <Missing title="That theme doesn't exist" />;
  if (progress.rating == null) return <LevelPicker title={title} />;
  return <RatedRun key={JSON.stringify(filter)} filter={filter} title={title} />;
}

function RatedRun({ filter, title }: { filter: Filter; title: string }) {
  const pool = useMemo(() => new PuzzlePool(filter), []);
  const progress = useProgress();
  const [puzzle, setPuzzle] = useState<Puzzle | null>(null);
  const [state, setState] = useState<'loading' | 'ready' | 'empty' | 'error'>('loading');
  const [delta, setDelta] = useState<number | null>(null);
  const asking = useRef(0);
  // Leaving the page stops a search still downloading shards.
  const stop = useMemo(() => new AbortController(), []);
  useEffect(() => () => stop.abort(), []);

  const next = () => {
    const run = ++asking.current;
    setState('loading');
    const p = getProgress();
    pool
      .pick((p.rating ?? 1500) + p.difficulty * STEP, hasSeen, undefined, stop.signal)
      .then((found) => {
        if (run !== asking.current || stop.signal.aborted) return;
        if (!found) return setState('empty');
        // Seen as soon as it's shown, so a reload brings a new one rather than a free second look.
        markSeen(found.id);
        setDelta(null);
        setPuzzle(found);
        setState('ready');
      })
      .catch(() => run === asking.current && setState('error'));
  };
  useEffect(next, []);

  const aside = <RatingChip progress={progress} delta={delta} />;
  if (state === 'empty') return <Missing title={`You've played every ${title.toLowerCase()}`} detail="Pick another theme, or come back to them later." />;
  if (state === 'error' && !puzzle)
    return (
      <Missing title="The puzzles didn't load" detail="Check your connection and try again.">
        <button class="button" type="button" onClick={next}>
          Try again
        </button>
      </Missing>
    );
  if (!puzzle) return <PuzzleShell title={title} aside={aside} board={<div class="board puzzle-board puzzle-board-empty" />} children={<p class="muted">Finding a puzzle…</p>} />;
  return (
    <RatedPuzzle
      key={puzzle.id}
      puzzle={puzzle}
      title={title}
      aside={aside}
      progress={progress}
      loading={state === 'loading'}
      failedToLoad={state === 'error'}
      onRated={setDelta}
      onNext={next}
    />
  );
}

function RatedPuzzle(props: {
  puzzle: Puzzle;
  title: string;
  aside: ComponentChildren;
  progress: PuzzleProgress;
  loading: boolean;
  failedToLoad: boolean;
  onRated: (delta: number) => void;
  onNext: () => void;
}) {
  const { puzzle, progress } = props;
  const [delta, setDelta] = useState<number | null>(null);
  const solver = useSolver(puzzle, {
    onVerdict: (ok) => {
      const d = rate(puzzle, ok);
      setDelta(d);
      props.onRated(d);
    },
  });
  const change = delta === null ? undefined : `${delta >= 0 ? '+' : '−'}${Math.abs(delta)} · your rating is now ${Math.round(getProgress().rating ?? 0)}.`;
  const say = verdictOf(solver, {
    solved: change ? `${change}` : undefined,
    failed: change ? `This one counts as missed (${change.split(' ·')[0]}).${solver.done ? '' : ' You can still finish it.'}` : undefined,
  });
  if (solver.broken) return <Missing title="This puzzle is damaged" detail="Its moves don't fit the position." />;
  return (
    <PuzzleShell title={props.title} aside={props.aside} board={solver.board}>
      <Coach tone={say.tone} lead={say.lead}>
        {say.detail ? <p class="coach-detail">{say.detail}</p> : null}
      </Coach>
      <SolveActions
        solver={solver}
        next={{ label: props.loading ? 'Finding a puzzle…' : props.failedToLoad ? 'Try loading again' : 'Next puzzle', onClick: props.onNext, disabled: props.loading }}
      />
      {solver.done ? <PuzzleInfo puzzle={puzzle} /> : null}
      <div class="puzzle-settings">
        <div class="segmented" role="radiogroup" aria-label="Difficulty">
          {DIFFICULTY.map((d) => (
            <button key={d.value} type="button" role="radio" aria-checked={progress.difficulty === d.value} onClick={() => updateProgress({ difficulty: d.value })}>
              {d.label}
            </button>
          ))}
        </div>
        <p class="muted">
          {progress.difficulty ? `Puzzles about ${STEP} points ${progress.difficulty < 0 ? 'below' : 'above'} your rating.` : 'Puzzles near your rating.'} Hints and the solution count as a miss.{' '}
          <button type="button" class="link-button" onClick={() => updateProgress({ rating: null })}>
            Start again from a level
          </button>
        </p>
      </div>
      <SessionStrip attempts={progress.recent} />
    </PuzzleShell>
  );
}

function RatingChip({ progress, delta }: { progress: PuzzleProgress; delta: number | null }) {
  if (progress.rating == null) return null;
  // Provisional until the deviation has narrowed, as lichess marks it with a question mark.
  const provisional = progress.rd > 110;
  return (
    <p class="puzzle-rating" aria-live="polite">
      <span class="puzzle-rating-label">Your rating</span>
      <strong key={Math.round(progress.rating)}>
        {Math.round(progress.rating)}
        {provisional ? <span title="Provisional: a few more puzzles will settle it">?</span> : null}
      </strong>
      {delta ? (
        <span class={delta > 0 ? 'delta-up' : 'delta-down'} key={`d${progress.played}`}>
          {delta > 0 ? '+' : '−'}
          {Math.abs(delta)}
        </span>
      ) : null}
    </p>
  );
}

/** First visit: pick a level to start from, so the first puzzles aren't far too easy or hard. */
function LevelPicker({ title }: { title: string }) {
  return (
    <main class="puzzle-page puzzle-page-narrow">
      <div class="puzzle-head">
        <a class="lesson-back" href="#/puzzles">
          ← Puzzles
        </a>
        <h1 class="puzzle-title">{title}</h1>
      </div>
      <section class="puzzle-levels" aria-labelledby="level-title">
        <h2 id="level-title">Where should we start?</h2>
        <p class="muted">Your puzzle rating moves with every puzzle, so this only sets the first few. You can change it later.</p>
        <div class="puzzle-level-list">
          {LEVELS.map((l, i) => (
            <button key={l.rating} type="button" class="puzzle-level" onClick={() => startAt(l.rating)} ref={i === 1 ? focusQuietly : undefined}>
              <Piece role={(['pawn', 'knight', 'rook', 'queen'] as const)[i]} color="white" />
              <span>
                <strong>{l.label}</strong>
                <span>{l.detail}</span>
              </span>
              <span class="puzzle-level-rating">{l.rating}</span>
            </button>
          ))}
        </div>
      </section>
    </main>
  );
}

// ---------------------------------------------------------------- one puzzle, and the daily one

function SinglePuzzle({ id }: { id: string }) {
  const [puzzle, setPuzzle] = useState<Puzzle | null | undefined>(undefined);
  const [error, setError] = useState(false);
  useEffect(() => {
    findPuzzle(id).then(setPuzzle, () => setError(true));
  }, [id]);
  if (error) return <Missing title="The puzzle didn't load" detail="Check your connection and reload the page." />;
  if (puzzle === null) return <Missing title="There's no puzzle with that number" />;
  if (!puzzle) return <PuzzleShell title={`Puzzle ${id}`} board={<div class="board puzzle-board puzzle-board-empty" />} children={<p class="muted">Loading…</p>} />;
  return <Practice key={puzzle.id} puzzle={puzzle} title={`Puzzle ${puzzle.id}`} />;
}

/** An unrated puzzle: from a link, or one you've played before. */
function Practice({ puzzle, title }: { puzzle: Puzzle; title: string }) {
  const solver = useSolver(puzzle, { onVerdict: () => markSeen(puzzle.id) });
  const say = verdictOf(solver, { solved: 'This one is for practice, so your rating stays as it is.' });
  if (solver.broken) return <Missing title="This puzzle is damaged" detail="Its moves don't fit the position." />;
  return (
    <PuzzleShell title={title} board={solver.board}>
      <Coach tone={say.tone} lead={say.lead}>
        {say.detail ? <p class="coach-detail">{say.detail}</p> : null}
      </Coach>
      <SolveActions solver={solver} next={{ label: 'Rated puzzles', onClick: () => (location.hash = '#/puzzles/rated') }} />
      {solver.done ? <PuzzleInfo puzzle={puzzle} /> : null}
    </PuzzleShell>
  );
}

/** Consecutive days solved, ending today (or yesterday, while today's is still open). */
export function streak(daily: Record<string, boolean>, day = today()): number {
  // Missed today: the run is over. Not tried yet: it still stands from yesterday.
  if (daily[day] === false) return 0;
  let n = 0;
  const d = new Date(`${day}T12:00:00`);
  if (!daily[day]) d.setDate(d.getDate() - 1);
  while (daily[today(d)]) {
    n++;
    d.setDate(d.getDate() - 1);
  }
  return n;
}

/** Today's date, kept current: it turns over at local midnight, and is checked again when the tab comes back. */
function useToday(): string {
  const [day, setDay] = useState(today);
  useEffect(() => {
    const check = () => setDay(today());
    const untilMidnight = () => {
      const next = new Date();
      next.setHours(24, 0, 1, 0);
      return next.getTime() - Date.now();
    };
    let timer = setTimeout(function tick() {
      check();
      timer = setTimeout(tick, untilMidnight());
    }, untilMidnight());
    document.addEventListener('visibilitychange', check);
    return () => {
      clearTimeout(timer);
      document.removeEventListener('visibilitychange', check);
    };
  }, []);
  return day;
}

/** A new day brings a new puzzle, even on a page left open overnight. */
function Daily() {
  const day = useToday();
  return <DailyOf key={day} day={day} />;
}

function DailyOf({ day }: { day: string }) {
  const [puzzle, setPuzzle] = useState<Puzzle | null>(null);
  const [error, setError] = useState(false);
  useEffect(() => {
    dailyPuzzle(day).then(setPuzzle, () => setError(true));
  }, []);
  const label = new Date(`${day}T12:00:00`).toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' });
  if (error) return <Missing title="Today's puzzle didn't load" detail="Check your connection and reload the page." />;
  if (!puzzle) return <PuzzleShell title="Puzzle of the day" board={<div class="board puzzle-board puzzle-board-empty" />} children={<p class="muted">Loading…</p>} />;
  return <DailyPuzzle key={puzzle.id} puzzle={puzzle} day={day} label={label} />;
}

function DailyPuzzle({ puzzle, day, label }: { puzzle: Puzzle; day: string; label: string }) {
  const progress = useProgress();
  const before = progress.daily[day];
  const solver = useSolver(puzzle, {
    // The first try of the day is the one that counts. Seen, too: it's in the rated puzzles, and its answer is known now.
    onVerdict: (ok) => {
      markSeen(puzzle.id);
      // Checked on the stored progress, which another tab may have just given today's result.
      updateProgress((p) => (p.daily[day] === undefined ? { daily: { ...p.daily, [day]: ok } } : {}));
    },
  });
  const days = streak(progress.daily, day);
  const say = verdictOf(solver, {
    solved: days > 1 ? `${days} days in a row. Come back tomorrow for the next one.` : 'Come back tomorrow for the next one.',
    failed: before === undefined ? 'Today counts as missed, but you can still finish it.' : undefined,
  });
  if (solver.broken) return <Missing title="Today's puzzle is damaged" detail="Its moves don't fit the position." />;
  return (
    <PuzzleShell title="Puzzle of the day" aside={<span class="muted puzzle-date">{label}</span>} board={solver.board}>
      {before !== undefined && solver.view.phase === 'intro' ? (
        <p class="puzzle-note">{before ? "You've solved today's puzzle. Here it is again." : "You've tried today's puzzle. Here it is again, just for practice."}</p>
      ) : null}
      <Coach tone={say.tone} lead={say.lead}>
        {say.detail ? <p class="coach-detail">{say.detail}</p> : null}
      </Coach>
      <SolveActions solver={solver} next={{ label: 'More puzzles', onClick: () => (location.hash = '#/puzzles/rated') }} />
      {solver.done ? <PuzzleInfo puzzle={puzzle} /> : null}
      {days ? (
        <p class="muted">
          Daily streak: <strong>{days}</strong> {days === 1 ? 'day' : 'days'}
        </p>
      ) : null}
    </PuzzleShell>
  );
}

// ---------------------------------------------------------------- the way in

function Hub() {
  const progress = useProgress();
  const mistakes = useMistakes();
  const day = useToday();
  const [daily, setDaily] = useState<Puzzle | null>(null);
  const settings = useSettings();
  useEffect(() => {
    dailyPuzzle(day).then(setDaily, () => {});
  }, [day]);
  const open = mistakes.filter((m) => !m.solved).length;
  const days = streak(progress.daily, day);
  const best = progress.rush;

  return (
    <main class="puzzles">
      <header class="learn-head puzzles-head">
        <h1>Puzzles</h1>
        <p class="home-lede">
          {PUZZLE_COUNT.toLocaleString('en')} puzzles to sharpen your tactics, from mate in one to deep endgames. Free, with no
          account and no daily limit; your rating is kept in this browser.
        </p>
      </header>

      <div class="puzzle-doors">
        <a class="door puzzle-door-rated" href="#/puzzles/rated">
          <div class="door-body">
            <h2>Rated puzzles</h2>
            <p>Puzzles picked for your level. Solve one and your rating goes up and the next is harder; miss one and they ease off.</p>
            <span class="door-cta">{progress.rating == null ? 'Find your level' : 'Solve puzzles'} →</span>
            {progress.rating != null ? (
              <span class="door-meta">
                Rating {Math.round(progress.rating)}
                {progress.played ? ` · ${progress.solved} of ${progress.played} solved` : ''}
              </span>
            ) : null}
          </div>
        </a>

        <a class="door puzzle-door-daily" href="#/puzzles/daily">
          <div class="door-board">
            {daily ? (
              <Board fen={afterSetup(daily)} orientation={afterSetup(daily).split(' ')[1] === 'b' ? 'black' : 'white'} shapes={[]} coordinates={false} animate={settings.motion} />
            ) : null}
          </div>
          <div class="door-body">
            <h2>Puzzle of the day</h2>
            <p>One puzzle a day, the same for everyone.</p>
            <span class="door-cta">{progress.daily[day] === true ? 'Solved today ✓' : progress.daily[day] === false ? 'Tried today' : "Solve today's puzzle"} →</span>
            {days ? <span class="door-meta">{days}-day streak</span> : null}
          </div>
        </a>

        <a class="door puzzle-door-rush" href="#/puzzles/rush">
          <div class="door-body">
            <h2>Puzzle Rush</h2>
            <p>As many as you can solve in 3 or 5 minutes, or until three misses. They start easy and get harder fast.</p>
            <span class="door-cta">Start a rush →</span>
            {best['3'] || best['5'] || best.survival ? (
              <span class="door-meta">
                Best: {best['3']} in 3 min · {best['5']} in 5 min · {best.survival} survival
              </span>
            ) : null}
          </div>
        </a>

        <a class="door puzzle-door-mistakes" href="#/puzzles/mistakes">
          <div class="door-body">
            <h2>Your mistakes</h2>
            <p>The moves you got wrong in games you reviewed, to find the better move this time.</p>
            <span class="door-cta">{mistakes.length ? (open ? `Practise ${open} ${open === 1 ? 'mistake' : 'mistakes'}` : 'All solved. Review them') : 'How it works'} →</span>
          </div>
        </a>

        {ORIGINAL_COUNT ? (
          <a class="door puzzle-door-originals" href="#/puzzles/originals">
            <div class="door-body">
              <h2>Kibitz originals</h2>
              <p>
                {ORIGINAL_COUNT.toLocaleString('en')} puzzles made here: tactics from games between Kibitz's bots, and endgames proven
                move by move with tablebases.
              </p>
              <span class="door-cta">Solve originals →</span>
            </div>
          </a>
        ) : null}
      </div>

      {THEME_GROUPS.map((group) => (
        <section key={group.title} class="unit" aria-labelledby={`themes-${group.title}`}>
          <h2 id={`themes-${group.title}`}>{group.title}</h2>
          <ul class="lesson-grid theme-grid-list">
            {group.themes
              .filter((th) => filterSize({ theme: th.id }))
              .map((th) => (
                <li key={th.id}>
                  <a class="lesson-card theme-card" href={`#/puzzles/theme/${th.id}`}>
                    <span class="lesson-card-text">
                      <strong>{th.label}</strong>
                      <span>{th.blurb}</span>
                    </span>
                    <span class="theme-count">{filterSize({ theme: th.id }).toLocaleString('en')}</span>
                  </a>
                </li>
              ))}
          </ul>
        </section>
      ))}

      <footer class="home-foot">
        <p>
          Most puzzles come from{' '}
          <a href="https://database.lichess.org/#puzzles" target="_blank" rel="noopener noreferrer">
            lichess's puzzle database
          </a>{' '}
          (CC0), taken from real games and rated by lichess players. Kibitz picks the best-liked of them for every level and theme.
        </p>
      </footer>
    </main>
  );
}
