import type { Key } from '@lichess-org/chessground/types';
import { Chess } from 'chess.js';
import type { ComponentChildren } from 'preact';
import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import { LiveEngine } from '../engine';
import type { Movable } from '../ui/board';
import { TopNav } from '../ui/nav';
import { reducedMotion } from '../ui/theme';
import { BotGame, FINAL } from './bot';
import { LESSONS } from './course';
import { arrowShape, colorOf, destsOf, dotShape, hasKings, loadPosition, play, playUci, starShape, uciOf, whiteToMove } from './play';
import { saveStars } from './progress';
import type { CaptureTask, ChooseTask, CollectTask, Demo, Lesson, MateTask, MovesTask, Task } from './types';
import { Coach, LessonBoard, Shell, Stars, useLater } from './ui';
import './learn.css';

export function LessonPage({ id }: { id: string }) {
  if (id === FINAL.id) return <BotGame />;
  const lesson = LESSONS.find((l) => l.id === id);
  if (!lesson) {
    return (
      <main class="lesson lesson-missing">
        <TopNav current="learn" />
        <p>
          That lesson doesn't exist. <a href="#/learn">Back to the course</a>
        </p>
      </main>
    );
  }
  return <LessonRunner lesson={lesson} />;
}

/** Stars for a whole lesson, from the mistakes made across its tasks. */
export const starsFor = (mistakes: number) => (mistakes === 0 ? 3 : mistakes <= 2 ? 2 : 1);

function LessonRunner({ lesson }: { lesson: Lesson }) {
  // -1 is the explainer, then one step per task, then the result.
  const [step, setStep] = useState(-1);
  const [mistakes, setMistakes] = useState(0);
  const [round, setRound] = useState(0);
  const tasks = lesson.tasks;

  const next = (taskMistakes: number) => {
    const total = mistakes + taskMistakes;
    setMistakes(total);
    if (step === tasks.length - 1) saveStars(lesson.id, starsFor(total));
    setStep(step + 1);
  };
  const restart = () => {
    setMistakes(0);
    setStep(0);
    setRound(round + 1);
  };

  const frame = { lesson, step };
  if (step === -1) return <IntroView {...frame} onStart={() => setStep(0)} />;
  if (step === tasks.length) return <DoneView {...frame} mistakes={mistakes} onRestart={restart} />;
  return <TaskView key={`${round}:${step}`} {...frame} task={tasks[step]} onNext={next} />;
}

function TaskView({ task, ...rest }: { lesson: Lesson; step: number; task: Task; onNext: (mistakes: number) => void }) {
  switch (task.type) {
    case 'collect':
    case 'capture':
      return <PracticeView {...rest} task={task} />;
    case 'moves':
      return <MovesView {...rest} task={task} />;
    case 'mate':
      return <MateView {...rest} task={task} />;
    case 'choose':
      return <ChooseView {...rest} task={task} />;
  }
}

// ---------------------------------------------------------------- layout

function Frame({ lesson, step, board, children }: { lesson: Lesson; step: number; board: ComponentChildren; children: ComponentChildren }) {
  const parts = lesson.tasks.length + 1;
  return (
    <Shell
      title={lesson.title}
      board={board}
      head={
        <ol class="lesson-pips" aria-label={`Part ${Math.min(step + 2, parts)} of ${parts}`}>
          {[-1, ...lesson.tasks.map((_, i) => i)].map((i) => (
            <li key={i} class={i < step ? 'pip-done' : i === step ? 'pip-now' : ''} />
          ))}
        </ol>
      }
    >
      {children}
    </Shell>
  );
}

// ---------------------------------------------------------------- explainer

function IntroView({ lesson, step, onStart }: { lesson: Lesson; step: number; onStart: () => void }) {
  return (
    <Frame lesson={lesson} step={step} board={<DemoBoard demo={lesson.intro.demo} />}>
      <Coach lead={lesson.title}>
        {lesson.intro.text.map((p) => (
          <p key={p} class="coach-detail">
            {p}
          </p>
        ))}
      </Coach>
      <div class="lesson-actions">
        <button class="button button-primary" type="button" onClick={onStart} autofocus>
          Start
        </button>
        <span class="muted">
          {lesson.tasks.length} {lesson.tasks.length === 1 ? 'task' : 'tasks'}
        </span>
      </div>
    </Frame>
  );
}

/** Plays the demo moves on a loop, pausing on the start position where the dots and arrows show. */
function DemoBoard({ demo }: { demo: Demo }) {
  const [state, setState] = useState<{ fen: string; lastMove?: Key[]; at: number }>({ fen: demo.fen, at: 0 });
  useEffect(() => {
    const moves = demo.moves ?? [];
    if (!moves.length || reducedMotion()) return;
    let chess = loadPosition(demo.fen);
    let at = 0;
    let timer = 0;
    const tick = () => {
      if (at === moves.length) {
        chess = loadPosition(demo.fen);
        at = 0;
        setState({ fen: demo.fen, at });
        timer = window.setTimeout(tick, 2200);
        return;
      }
      const m = playUci(chess, moves[at]);
      if (!m) return;
      at += 1;
      // Kingless practice boards keep White moving, as in the tasks.
      if (!hasKings(demo.fen)) chess = loadPosition(whiteToMove(chess.fen()));
      setState({ fen: chess.fen(), lastMove: [m.from as Key, m.to as Key], at });
      timer = window.setTimeout(tick, at === moves.length ? 1600 : 950);
    };
    timer = window.setTimeout(tick, 2200);
    return () => clearTimeout(timer);
  }, [demo]);

  const shapes = useMemo(
    () => (state.at === 0 ? [...(demo.dots ?? []).map(dotShape), ...(demo.arrows ?? []).map((a) => arrowShape(a))] : []),
    [demo, state.at],
  );
  return <LessonBoard fen={state.fen} orientation={colorOf(demo.fen)} lastMove={state.lastMove} shapes={shapes} />;
}

// ---------------------------------------------------------------- collect and capture

const squaresOf = (uci?: string) => (uci ? [uci.slice(0, 2) as Key, uci.slice(2, 4) as Key] : undefined);

const blackPieces = (fen: string) => (fen.split(' ')[0].match(/[pnbrqk]/g) ?? []).length;

function PracticeView({ lesson, step, task, onNext }: { lesson: Lesson; step: number; task: CollectTask | CaptureTask; onNext: (m: number) => void }) {
  const start = whiteToMove(task.fen);
  const initialStars = task.type === 'collect' ? task.stars : [];
  const [fen, setFen] = useState(start);
  const [stars, setStars] = useState(initialStars);
  const [moves, setMoves] = useState(0);
  const [lastMove, setLastMove] = useState<Key[]>();

  const solved = task.type === 'collect' ? stars.length === 0 : blackPieces(fen) === 0;
  const over = Math.max(0, moves - task.par);

  const movable = useMemo<Movable | undefined>(() => {
    if (solved) return undefined;
    return {
      color: 'white',
      dests: destsOf(loadPosition(fen)),
      onMove: (orig, dest) => {
        const chess = loadPosition(fen);
        const m = play(chess, orig, dest);
        if (!m) return;
        setFen(whiteToMove(chess.fen()));
        setMoves((n) => n + 1);
        setLastMove([orig, dest]);
        setStars((s) => s.filter((sq) => sq !== dest));
      },
    };
  }, [fen, solved]);
  const shapes = useMemo(() => stars.map(starShape), [stars]);

  const reset = () => {
    setFen(start);
    setStars(initialStars);
    setMoves(0);
    setLastMove(undefined);
  };

  return (
    <Frame lesson={lesson} step={step} board={<LessonBoard fen={fen} lastMove={lastMove} shapes={shapes} movable={movable} />}>
      <Coach tone={solved ? 'good' : 'neutral'} lead={solved ? (over ? 'Done.' : 'Perfect.') : task.prompt}>
        {solved ? (
          <p class="coach-detail">
            {over
              ? `${moves} moves. It can be done in ${task.par}; try again for full marks, or carry on.`
              : `${moves} ${moves === 1 ? 'move' : 'moves'}, as few as possible.`}
            {task.explain ? ` ${task.explain}` : ''}
          </p>
        ) : (
          <p class="coach-line">
            {task.type === 'collect' ? `${stars.length} ${stars.length === 1 ? 'star' : 'stars'} left · ` : ''}
            {moves} {moves === 1 ? 'move' : 'moves'} · best is {task.par}
          </p>
        )}
      </Coach>
      <div class="lesson-actions">
        {solved ? (
          <button class="button button-primary" type="button" onClick={() => onNext(over)} autofocus>
            Continue
          </button>
        ) : null}
        <button class="button" type="button" onClick={reset} disabled={!moves}>
          {solved ? 'Try again' : 'Start over'}
        </button>
      </div>
    </Frame>
  );
}

// ---------------------------------------------------------------- find the move

/** One move that meets a 'check' or 'mate' goal, to show when the learner asks. */
function findGoalMove(fen: string, goal: 'check' | 'mate'): string | undefined {
  const chess = new Chess(fen);
  for (const m of chess.moves({ verbose: true })) {
    if (goal === 'mate' ? m.san.endsWith('#') : m.san.includes('+') || m.san.endsWith('#')) return uciOf(m);
  }
  return undefined;
}

/** What a wrong move did, in words, plus the task's hint when it has one. */
function wrongMoveNote(after: Chess, goal: MovesTask['steps'][number]['accept'], hint?: string): string {
  const tip = hint ? ` ${hint}` : '';
  if (goal === 'check') return `That move doesn't attack the king.${tip}`;
  if (goal !== 'mate') return hint ?? 'Not that one. Try again.';
  if (after.isStalemate()) return `That's stalemate: the king can't move but isn't in check, so it's a draw.${tip}`;
  if (after.inCheck()) return `That's check, but the king can still get out.${tip}`;
  return `That isn't check, so it can't be checkmate.${tip}`;
}

function MovesView({ lesson, step, task, onNext }: { lesson: Lesson; step: number; task: MovesTask; onNext: (m: number) => void }) {
  const later = useLater();
  const [at, setAt] = useState(0);
  const [fen, setFen] = useState(task.fen);
  const [lastMove, setLastMove] = useState(squaresOf(task.lastMove));
  const [mistakes, setMistakes] = useState(0);
  const [status, setStatus] = useState<'play' | 'wrong' | 'reply' | 'solved'>('play');
  const [feedback, setFeedback] = useState<string>();
  const [reveal, setReveal] = useState(false);
  const learner = colorOf(task.fen);
  const goal = task.steps[at].accept;

  const answer = useMemo(() => (Array.isArray(goal) ? goal[0] : findGoalMove(fen, goal)), [goal, fen]);

  const movable = useMemo<Movable | undefined>(() => {
    if (status !== 'play') return undefined;
    return {
      color: learner,
      dests: destsOf(new Chess(fen)),
      onMove: (orig, dest) => {
        const chess = new Chess(fen);
        const m = play(chess, orig, dest);
        if (!m) return;
        const ok = goal === 'check' ? chess.inCheck() : goal === 'mate' ? chess.isCheckmate() : goal.includes(uciOf(m));
        const before = { fen, lastMove };
        setFen(chess.fen());
        setLastMove([orig, dest]);
        if (!ok) {
          setMistakes((n) => n + 1);
          setStatus('wrong');
          setFeedback(wrongMoveNote(chess, goal, task.hint));
          later(() => {
            setFen(before.fen);
            setLastMove(before.lastMove);
            setStatus('play');
          }, 900);
          return;
        }
        setFeedback(undefined);
        setReveal(false);
        const reply = task.steps[at].reply;
        if (at === task.steps.length - 1 || !reply) {
          setStatus('solved');
          return;
        }
        setStatus('reply');
        later(() => {
          const r = playUci(chess, reply);
          if (r) {
            setFen(chess.fen());
            setLastMove([r.from as Key, r.to as Key]);
          }
          setAt(at + 1);
          setStatus('play');
        }, 600);
      },
    };
  }, [fen, lastMove, status, at]);

  const shapes = useMemo(
    () => (status === 'wrong' && lastMove ? [arrowShape(lastMove.join(''), 'red')] : reveal && answer ? [arrowShape(answer)] : []),
    [status, lastMove, reveal, answer],
  );

  const solved = status === 'solved';
  const lead = solved ? (mistakes ? 'Got it.' : 'Exactly right.') : task.prompt;
  return (
    <Frame
      lesson={lesson}
      step={step}
      board={<LessonBoard fen={fen} orientation={learner} lastMove={lastMove} shapes={shapes} movable={movable} />}
    >
      <Coach tone={solved ? 'good' : status === 'wrong' ? 'bad' : 'neutral'} lead={lead}>
        {solved && task.explain ? <p class="coach-detail">{task.explain}</p> : null}
        {!solved && feedback ? <p class="coach-detail">{feedback}</p> : null}
        {!solved && !feedback ? (
          <p class="coach-line">
            {learner === 'white' ? 'White' : 'Black'} to move
            {task.steps.length > 1 ? ` · move ${at + 1} of ${task.steps.length}` : ''}
          </p>
        ) : null}
      </Coach>
      <div class="lesson-actions">
        {solved ? (
          <button class="button button-primary" type="button" onClick={() => onNext(mistakes)} autofocus>
            Continue
          </button>
        ) : mistakes >= 2 && answer ? (
          <button class="button" type="button" onClick={() => setReveal(true)} aria-pressed={reveal}>
            Show me
          </button>
        ) : null}
      </div>
    </Frame>
  );
}

// ---------------------------------------------------------------- checkmate against the engine

function MateView({ lesson, step, task, onNext }: { lesson: Lesson; step: number; task: MateTask; onNext: (m: number) => void }) {
  const later = useLater();
  const engine = useRef<LiveEngine | null>(null);
  const [fen, setFen] = useState(task.fen);
  const [lastMove, setLastMove] = useState<Key[]>();
  const [moves, setMoves] = useState(0);
  const [hints, setHints] = useState(0);
  const [hint, setHint] = useState<string>();
  const [status, setStatus] = useState<'play' | 'thinking' | 'solved' | 'failed'>('play');
  const [reason, setReason] = useState<string>();
  const learner = colorOf(task.fen);
  // Bumped by Start over (and unmount), so a reply still on its way from the last attempt is dropped.
  const attempt = useRef(0);

  useEffect(() => {
    engine.current = new LiveEngine(1);
    return () => {
      attempt.current++;
      engine.current?.terminate();
    };
  }, []);

  const fail = (why: string) => {
    setStatus('failed');
    setReason(why);
  };
  // A failed engine is replaced, so Start over gets a working one.
  const engineFailed = (id: number) => {
    if (id !== attempt.current) return;
    engine.current?.terminate();
    engine.current = new LiveEngine(1);
    fail("The computer stopped answering. Start over to try again.");
  };

  const movable = useMemo<Movable | undefined>(() => {
    if (status !== 'play') return undefined;
    return {
      color: learner,
      dests: destsOf(new Chess(fen)),
      onMove: (orig, dest) => {
        const chess = new Chess(fen);
        const m = play(chess, orig, dest);
        if (!m) return;
        const count = moves + 1;
        setFen(chess.fen());
        setLastMove([orig, dest]);
        setMoves(count);
        setHint(undefined);
        if (chess.isCheckmate()) return setStatus('solved');
        if (chess.isStalemate()) return fail("Stalemate: the king can't move but isn't in check, so it's a draw.");
        if (count >= task.limit) return fail(`That's ${count} moves without mate.`);
        setStatus('thinking');
        const id = attempt.current;
        engine.current
          ?.analyse(chess.fen(), 10)
          .then((r) => {
            if (id !== attempt.current) return;
            if (!r?.best) return engineFailed(id);
            const reply = playUci(chess, r.best);
            later(() => {
              if (id !== attempt.current || !reply) return;
              setFen(chess.fen());
              setLastMove([reply.from as Key, reply.to as Key]);
              if (chess.isInsufficientMaterial()) return fail('The king took your last attacker, so mate is no longer possible.');
              setStatus('play');
            }, 250);
          })
          .catch(() => engineFailed(id));
      },
    };
  }, [fen, status, moves]);

  const askHint = () => {
    const id = attempt.current;
    setHints((n) => n + 1);
    engine.current
      ?.analyse(fen, 14)
      .then((r) => id === attempt.current && r?.best && setHint(r.best))
      .catch(() => engineFailed(id));
  };
  const reset = () => {
    attempt.current++;
    engine.current?.stop();
    setFen(task.fen);
    setLastMove(undefined);
    setMoves(0);
    setHint(undefined);
    setReason(undefined);
    setStatus('play');
  };

  const shapes = useMemo(() => (hint ? [arrowShape(hint)] : []), [hint]);
  const mistakes = Math.max(0, moves - task.par) + hints;
  const solved = status === 'solved';
  return (
    <Frame
      lesson={lesson}
      step={step}
      board={<LessonBoard fen={fen} orientation={learner} lastMove={lastMove} shapes={shapes} movable={movable} />}
    >
      <Coach
        tone={solved ? 'good' : status === 'failed' ? 'bad' : 'neutral'}
        lead={solved ? 'Checkmate.' : status === 'failed' ? 'Not this time.' : task.prompt}
      >
        {solved ? (
          <p class="coach-detail">
            Mate in {moves}.{moves <= task.par ? ' Nice and quick.' : ` Try it in ${task.par} or fewer next time.`}
            {task.explain ? ` ${task.explain}` : ''}
          </p>
        ) : status === 'failed' ? (
          <p class="coach-detail">{reason}</p>
        ) : (
          <p class="coach-line">
            {status === 'thinking' ? 'The king is looking for a way out…' : `${moves} ${moves === 1 ? 'move' : 'moves'} · mate in ${task.par} is possible`}
          </p>
        )}
      </Coach>
      <div class="lesson-actions">
        {solved ? (
          <button class="button button-primary" type="button" onClick={() => onNext(mistakes)} autofocus>
            Continue
          </button>
        ) : null}
        {status === 'play' ? (
          <button class="button" type="button" onClick={askHint}>
            Hint
          </button>
        ) : null}
        <button class="button" type="button" onClick={reset} disabled={!moves}>
          {solved ? 'Try again' : 'Start over'}
        </button>
      </div>
    </Frame>
  );
}

// ---------------------------------------------------------------- questions

function ChooseView({ lesson, step, task, onNext }: { lesson: Lesson; step: number; task: ChooseTask; onNext: (m: number) => void }) {
  const [wrong, setWrong] = useState<number[]>([]);
  const [solved, setSolved] = useState(false);
  const shapes = useMemo(() => [...(task.dots ?? []).map(dotShape), ...(task.arrows ?? []).map((a) => arrowShape(a))], [task]);

  return (
    <Frame
      lesson={lesson}
      step={step}
      board={<LessonBoard fen={task.fen} orientation={colorOf(task.fen)} lastMove={squaresOf(task.lastMove)} shapes={shapes} />}
    >
      <Coach tone={solved ? 'good' : wrong.length ? 'bad' : 'neutral'} lead={solved ? 'Right.' : task.prompt}>
        {solved && task.explain ? <p class="coach-detail">{task.explain}</p> : null}
        {!solved && wrong.length ? <p class="coach-detail">{task.hint ?? 'Not quite. Look again.'}</p> : null}
      </Coach>
      <div class="choices" role="group" aria-label="Answers">
        {task.options.map((o, i) => {
          const state = solved && i === task.answer ? 'right' : wrong.includes(i) ? 'wrong' : '';
          return (
            <button
              key={o}
              type="button"
              class={`choice ${state ? `choice-${state}` : ''}`}
              disabled={solved || wrong.includes(i)}
              onClick={() => (i === task.answer ? setSolved(true) : setWrong([...wrong, i]))}
            >
              {o}
            </button>
          );
        })}
      </div>
      <div class="lesson-actions">
        {solved ? (
          <button class="button button-primary" type="button" onClick={() => onNext(wrong.length)} autofocus>
            Continue
          </button>
        ) : null}
      </div>
    </Frame>
  );
}

// ---------------------------------------------------------------- result

function DoneView({ lesson, step, mistakes, onRestart }: { lesson: Lesson; step: number; mistakes: number; onRestart: () => void }) {
  const stars = starsFor(mistakes);
  const i = LESSONS.findIndex((l) => l.id === lesson.id);
  const next = LESSONS[i + 1];
  return (
    <Frame lesson={lesson} step={step} board={<DemoBoard demo={lesson.intro.demo} />}>
      <div class="lesson-done">
        <Stars count={stars} />
        <h2>{lesson.title}: done</h2>
        <p class="muted">
          {stars === 3
            ? 'No mistakes. Three stars.'
            : stars === 2
              ? `${mistakes} ${mistakes === 1 ? 'slip' : 'slips'} along the way. Two stars.`
              : 'You got through it. Run it again for more stars, or move on.'}
        </p>
      </div>
      <div class="lesson-actions">
        <a class="button button-primary" href={`#/learn/${next ? next.id : FINAL.id}`}>
          {next ? `Next: ${next.title}` : `Next: ${FINAL.title}`}
        </a>
        <button class="button" type="button" onClick={onRestart}>
          Try again
        </button>
      </div>
    </Frame>
  );
}
