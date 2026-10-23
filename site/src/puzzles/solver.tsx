import type { DrawShape } from '@lichess-org/chessground/draw';
import type { Key } from '@lichess-org/chessground/types';
import { Chess } from 'chess.js';
import type { JSX } from 'preact';
import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import { arrowShape, colorOf, destsOf } from '../learn/play';
import { useLater } from '../learn/ui';
import { useSettings } from '../settings';
import { play as sound } from '../sound';
import { Board, type Movable } from '../ui/board';
import { badgeSvg } from '../ui/grades';
import { isPromotion, PromotionPicker } from '../ui/promotion';
import type { Puzzle } from './data';

/**
 * Where a puzzle stands:
 *   intro    the position, a moment before the opponent's move that sets it up
 *   play     your move
 *   reply    you were right; the opponent is answering
 *   wrong    you were wrong; the move is shown, then taken back
 *   solved   done, with or without help along the way
 *   failed   a wrong move ended it (Puzzle Rush allows no second try)
 *   shown    you asked for the solution and watched it play out
 */
export type Phase = 'intro' | 'play' | 'reply' | 'wrong' | 'solved' | 'failed' | 'shown';

interface View {
  fen: string;
  lastMove?: Key[];
  /** Index into puzzle.moves of the next move to play. */
  ply: number;
  phase: Phase;
  /** The check or cross on the square a move of yours just landed on. */
  mark?: { square: Key; ok: boolean };
}

/** Plays a UCI move; null if it doesn't fit the position (a damaged puzzle). */
function step(fen: string, uci: string): { fen: string; from: Key; to: Key } | null {
  try {
    const m = new Chess(fen).move({ from: uci.slice(0, 2), to: uci.slice(2, 4), promotion: uci[4] });
    return { fen: m.after, from: m.from as Key, to: m.to as Key };
  } catch {
    return null;
  }
}

export interface Solver {
  view: View;
  /** The side you play, which the board faces. */
  color: 'white' | 'black';
  /** True once a wrong move, a hint or the solution means it no longer counts as solved cleanly. */
  failed: boolean;
  hints: number;
  done: boolean;
  /** A wrong move or bad data: the puzzle can't be played. */
  broken: boolean;
  /** The goal is to hold the draw rather than to win. */
  saving: boolean;
  hint: () => void;
  showSolution: () => void;
  retry: () => void;
  board: JSX.Element;
}

/**
 * Runs one puzzle on a board. `onVerdict` fires once, at the first thing that decides it (a wrong move, a hint,
 * the solution, or solving it clean), which is when a rated puzzle is scored; `onDone` fires once it ends.
 * In `strict` mode (Puzzle Rush) one wrong move ends the puzzle.
 */
export function useSolver(puzzle: Puzzle, opts: { strict?: boolean; onVerdict?: (ok: boolean) => void; onDone?: (ok: boolean) => void } = {}): Solver {
  const schedule = useLater();
  // Bumped by Retry, so the moves of a solution or a reply still on their way don't land on the new attempt.
  const epoch = useRef(0);
  const later = (fn: () => void, ms: number) => {
    const at = epoch.current;
    schedule(() => at === epoch.current && fn(), ms);
  };
  const settings = useSettings();
  const start = useMemo(() => step(puzzle.fen, puzzle.moves[0]), [puzzle]);
  const color = start ? colorOf(start.fen) : colorOf(puzzle.fen);
  const [view, setView] = useState<View>({ fen: puzzle.fen, ply: 0, phase: 'intro' });
  const [hints, setHints] = useState(0);
  const [promoting, setPromoting] = useState<{ from: Key; to: Key } | null>(null);
  const failed = useRef(false);
  const decided = useRef(false);
  const ended = useRef(false);
  const callbacks = useRef(opts);
  callbacks.current = opts;

  const verdict = (ok: boolean) => {
    if (decided.current) return;
    decided.current = true;
    callbacks.current.onVerdict?.(ok);
  };
  const end = (ok: boolean) => {
    if (ended.current) return;
    ended.current = true;
    callbacks.current.onDone?.(ok);
  };
  const fail = () => {
    failed.current = true;
    verdict(false);
  };

  // A moment to take in the position, then the opponent's move that sets the puzzle.
  useEffect(() => {
    if (!start) return;
    later(() => setView({ fen: start.fen, lastMove: [start.from, start.to], ply: 1, phase: 'play' }), 700);
  }, []);

  const expected = puzzle.moves[view.ply];

  const onMove = (orig: Key, dest: Key, promotion?: string) => {
    if (view.phase !== 'play') return;
    if (!promotion && isPromotion(view.fen, orig, dest)) return setPromoting({ from: orig, to: dest });
    setPromoting(null);
    const chess = new Chess(view.fen);
    let m;
    try {
      m = chess.move({ from: orig, to: dest, promotion });
    } catch {
      return;
    }
    const uci = m.lan;
    // Any checkmate is right, even one the puzzle didn't list; any other move must be the puzzle's.
    const mate = chess.isCheckmate();
    if (uci === expected || mate) {
      const last = mate || view.ply + 1 >= puzzle.moves.length;
      setView({ fen: chess.fen(), lastMove: [orig, dest], ply: view.ply + 1, phase: last ? 'solved' : 'reply', mark: { square: dest, ok: true } });
      setHints(0);
      if (last) {
        verdict(true);
        sound('correct', { delay: 0.12 });
        end(!failed.current);
        return;
      }
      const reply = step(chess.fen(), puzzle.moves[view.ply + 1]);
      later(() => {
        if (reply) setView({ fen: reply.fen, lastMove: [reply.from, reply.to], ply: view.ply + 2, phase: 'play' });
      }, 450);
      return;
    }
    fail();
    sound('wrong', { delay: 0.1 });
    const before = view;
    setView({ ...view, fen: chess.fen(), lastMove: [orig, dest], phase: opts.strict ? 'failed' : 'wrong', mark: { square: dest, ok: false } });
    if (opts.strict) return end(false);
    later(() => setView({ ...before, mark: undefined }), 850);
  };

  const hint = () => {
    if (view.phase !== 'play' || hints >= 2) return;
    fail();
    setHints(hints + 1);
  };

  // Plays the rest of the line, a move at a time, from wherever you are.
  const showSolution = () => {
    if (view.phase !== 'play') return;
    fail();
    setPromoting(null);
    let at = view;
    const rest = puzzle.moves.slice(view.ply);
    rest.forEach((uci, i) => {
      const next = step(at.fen, uci);
      if (!next) return;
      const done = i === rest.length - 1;
      at = { fen: next.fen, lastMove: [next.from, next.to], ply: at.ply + 1, phase: done ? 'shown' : 'reply' };
      const shown = at;
      later(() => {
        setView(shown);
        if (done) end(false);
      }, 250 + i * 750);
    });
    setView({ ...view, phase: 'reply', mark: undefined });
  };

  const retry = () => {
    if (!start) return;
    epoch.current++;
    setHints(0);
    setPromoting(null);
    setView({ fen: start.fen, lastMove: [start.from, start.to], ply: 1, phase: 'play' });
  };

  const movable = useMemo<Movable | undefined>(
    () => (view.phase === 'play' && !promoting ? { color, dests: destsOf(new Chess(view.fen)), onMove: (o, d) => onMove(o, d) } : undefined),
    [view, promoting],
  );

  const shapes = useMemo(() => {
    const out: DrawShape[] = [];
    if (view.mark) out.push({ orig: view.mark.square, customSvg: { html: badgeSvg(view.mark.ok ? 'best' : 'miss') } });
    if (view.phase === 'play' && expected && hints >= 1) out.push(hints >= 2 ? arrowShape(expected) : { orig: expected.slice(0, 2) as Key, brush: 'green' });
    return out;
  }, [view, hints, expected]);

  // The board shows the pawn already promoted to a queen while the piece is being chosen.
  const shownFen = promoting ? new Chess(view.fen).move({ ...promoting, promotion: 'q' }).after : view.fen;

  const board = (
    <div class="board puzzle-board" data-puzzle={puzzle.id}>
      <Board
        fen={shownFen}
        orientation={color}
        lastMove={promoting ? [promoting.from, promoting.to] : view.lastMove}
        shapes={shapes}
        movable={movable}
        typing
        sound={!promoting}
        coordinates={settings.coordinates}
        animate={settings.motion}
      />
      {promoting ? (
        <PromotionPicker
          square={promoting.to}
          color={color}
          orientation={color}
          onPick={(piece) => onMove(promoting.from, promoting.to, piece)}
          onCancel={() => setPromoting(null)}
        />
      ) : null}
    </div>
  );

  return {
    view,
    color,
    failed: failed.current,
    hints,
    done: view.phase === 'solved' || view.phase === 'failed' || view.phase === 'shown',
    broken: !start,
    saving: puzzle.themes.includes('equality'),
    hint,
    showSolution,
    retry,
    board,
  };
}
