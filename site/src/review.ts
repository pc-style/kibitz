import { Chess, type PieceSymbol } from 'chess.js';
import type { Line, PositionEval } from './engine';
import { epd, lineToSan, sideToMove, type Game, type Ply } from './game';

/** Order used by the summary table. */
export const GRADES = ['brilliant', 'great', 'best', 'excellent', 'good', 'book', 'inaccuracy', 'mistake', 'miss', 'blunder'] as const;
export type Grade = (typeof GRADES)[number] | 'forced';

// Thresholds are in win-chance points (0-100) lost by the move, the scale chess.com's
// "expected points" and lichess's accuracy both use.
const EXCELLENT = 2;
const GOOD = 5;
const INACCURACY = 10;
const MISTAKE = 20;
/** The best line beats the second-best by at least this much: an only move. */
const GREAT_GAP = 15;
/** At or above this the mover is already winning, so nothing is great, and only a sacrifice that forces mate is brilliant. */
const DECIDED = 92;
/** A brilliant sacrifice can't leave the mover worse off than this. */
const STILL_FINE = 35;
/** Material (in pawns) a sacrifice must leave en prise after counting what it captured. */
const SACRIFICE = 2;
/** After the opponent's mistake, losing this much of the chance you were given is a miss. */
const MISS_AFTER_OPPONENT = INACCURACY;

export const VALUE: Record<PieceSymbol, number> = { p: 1, n: 3, b: 3, r: 5, q: 9, k: 0 };

export interface Score {
  /** White's win chance, 0-100. */
  whiteWin: number;
  /** White's eval in centipawns, mates clamped to ±1000 (lichess's accuracy input). */
  whiteCp: number;
  label: string;
}

export interface MoveReview {
  grade: Grade;
  /** Win-chance points the move gave away. */
  loss: number;
  best?: string;
  bestLine?: string[];
  /** For a brilliant move: the piece it left en prise. */
  sacrificed?: PieceSymbol;
}

export const winChance = (cp: number) => 50 + 50 * (2 / (1 + Math.exp(-0.00368208 * clamp(cp, -1000, 1000))) - 1);

const clamp = (x: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, x));

/** Win chance of a line for the side to move. */
export const lineWin = (line: Line) => (line.mate !== undefined ? (line.mate > 0 ? 100 : 0) : winChance(line.cp ?? 0));

export function scorePosition(game: Game, index: number, ev: PositionEval | undefined): Score | undefined {
  const fen = game.fens[index];
  const white = sideToMove(fen) === 'w';
  if (index === game.plies.length && game.ending) {
    if (game.ending === 'draw') return { whiteWin: 50, whiteCp: 0, label: '½-½' };
    return white ? { whiteWin: 0, whiteCp: -1000, label: '0-1' } : { whiteWin: 100, whiteCp: 1000, label: '1-0' };
  }
  const top = ev?.lines[0];
  if (!top) return undefined;
  const sign = white ? 1 : -1;
  if (top.mate !== undefined) {
    const m = top.mate * sign;
    return { whiteWin: m > 0 ? 100 : 0, whiteCp: m > 0 ? 1000 : -1000, label: `${m > 0 ? '' : '-'}M${Math.abs(m)}` };
  }
  const cp = (top.cp ?? 0) * sign;
  return { whiteWin: winChance(cp), whiteCp: clamp(cp, -1000, 1000), label: `${cp > 0 ? '+' : ''}${(cp / 100).toFixed(1)}` };
}

/**
 * The piece a move leaves en prise when that is worth at least a minor piece net of what it took.
 * A piece that was already en prise before the opponent's last move doesn't count: it's poisoned or
 * long-standing, not given up by this move. (One the opponent just attacked does: ignoring a threat.)
 */
function sacrificedPiece(ply: Ply, earlier?: string): PieceSymbol | undefined {
  const stale = new Set<string>();
  if (earlier) {
    const before = new Chess(earlier);
    if (before.turn() !== ply.color)
      for (const m of before.moves({ verbose: true })) {
        const defended = before.attackers(m.to, ply.color).length > 0;
        if (m.captured && VALUE[m.captured] - (defended ? VALUE[m.piece] : 0) > 0) stale.add(m.to + m.captured);
      }
  }
  const chess = new Chess(ply.fenAfter);
  let atStake = 0;
  let piece: PieceSymbol | undefined;
  for (const reply of chess.moves({ verbose: true })) {
    if (!reply.captured || reply.captured === 'p') continue;
    if (reply.to !== ply.to && stale.has(reply.to + reply.captured)) continue;
    const defended = chess.attackers(reply.to, ply.color).length > 0;
    const net = VALUE[reply.captured] - (defended ? VALUE[reply.piece] : 0);
    if (net > atStake) [atStake, piece] = [net, reply.captured];
  }
  return atStake - (ply.captured ? VALUE[ply.captured] : 0) >= SACRIFICE ? piece : undefined;
}

/** The same position with the other side to move (no en passant): what was already hanging before a game's first move. */
const passTurn = (fen: string) => {
  const parts = fen.split(' ');
  parts[1] = parts[1] === 'w' ? 'b' : 'w';
  parts[3] = '-';
  return parts.join(' ');
};

const isRecapture = (ply: Ply, prev: Ply | undefined) => !!prev?.captured && !!ply.captured && prev.to === ply.to;

export function reviewGame(
  game: Game,
  evals: (PositionEval | undefined)[],
  book: Set<string> | null,
): { scores: (Score | undefined)[]; moves: (MoveReview | undefined)[] } {
  const scores = game.fens.map((_, i) => scorePosition(game, i, evals[i]));
  const moves: (MoveReview | undefined)[] = [];
  let inBook = !!book;

  game.plies.forEach((ply, i) => {
    inBook = inBook && !!book?.has(epd(ply.fenAfter));
    if (inBook) return moves.push({ grade: 'book', loss: 0 });
    if (ply.legalCount === 1) return moves.push({ grade: 'forced', loss: 0 });

    const before = scores[i];
    const after = scores[i + 1];
    const lines = evals[i]?.lines ?? [];
    if (!before || !after || !lines.length) return moves.push(undefined);

    const mine = (s: Score) => (ply.color === 'w' ? s.whiteWin : 100 - s.whiteWin);
    const winBefore = mine(before);
    // When the move is one of the engine's own lines, its score from that same search is the steadier
    // measure: two separate shallow searches (before and after the move) can disagree wildly.
    const listed = lines.find((l, k) => k > 0 && l.pv[0] === ply.uci);
    const winAfter = listed ? Math.max(mine(after), lineWin(listed)) : mine(after);
    const loss = Math.max(0, winBefore - winAfter);
    const isBest = ply.uci === lines[0].pv[0];
    const gap = lines[1] ? lineWin(lines[0]) - lineWin(lines[1]) : 0;
    const prev = moves[i - 1];

    let grade: Grade;
    const forcesMate = winAfter === 100; // only a mate score reaches 100
    const sacrificed =
      (isBest || loss <= EXCELLENT) && (winBefore < DECIDED || forcesMate) && winAfter >= STILL_FINE ? sacrificedPiece(ply, game.fens[i - 1] ?? passTurn(ply.fenBefore)) : undefined;
    if (sacrificed) grade = 'brilliant';
    else if (isBest && gap >= GREAT_GAP && winBefore < DECIDED && !isRecapture(ply, game.plies[i - 1])) grade = 'great';
    else if (isBest) grade = 'best';
    else if (loss <= EXCELLENT) grade = 'excellent';
    else if (loss <= GOOD) grade = 'good';
    else if (loss <= INACCURACY) grade = 'inaccuracy';
    else if (loss <= MISTAKE) grade = 'mistake';
    else grade = 'blunder';

    const opponentErred = prev?.grade === 'mistake' || prev?.grade === 'blunder';
    if (!isBest && opponentErred && loss >= MISS_AFTER_OPPONENT && winAfter >= 30) grade = 'miss';

    const review: MoveReview = { grade, loss, sacrificed };
    if (!isBest) {
      review.bestLine = lineToSan(ply.fenBefore, lines[0].pv);
      review.best = review.bestLine[0];
    }
    moves.push(review);
  });

  return { scores, moves };
}

/** lichess's per-move accuracy from win chances before and after the move. */
export function moveAccuracy(before: number, after: number): number {
  if (after >= before) return 100;
  const raw = 103.1668100711649 * Math.exp(-0.04354415386753951 * (before - after)) - 3.166924740191411;
  return clamp(raw + 1, 0, 100);
}

function stdev(xs: number[]): number {
  const mean = xs.reduce((a, b) => a + b, 0) / xs.length;
  return Math.sqrt(xs.reduce((a, x) => a + (x - mean) ** 2, 0) / xs.length);
}

/**
 * Game accuracy per side, ported from lichess (AccuracyPercent.gameAccuracy): the mean of a
 * volatility-weighted average and a harmonic mean of per-move accuracies.
 */
export function gameAccuracy(scores: Score[], whiteMovesFirst: boolean): { w: number; b: number } | undefined {
  if (scores.length < 3) return undefined;
  const wins = scores.map((s) => winChance(s.whiteCp));
  const windowSize = clamp(Math.floor((wins.length - 1) / 10), 2, 8);
  const windows: number[][] = [];
  for (let k = 0; k < Math.min(windowSize, wins.length) - 2; k++) windows.push(wins.slice(0, windowSize));
  for (let k = 0; k + windowSize <= wins.length; k++) windows.push(wins.slice(k, k + windowSize));
  const weights = windows.map((xs) => clamp(stdev(xs), 0.5, 12));

  const per = { w: [] as [number, number][], b: [] as [number, number][] };
  for (let i = 0; i + 1 < wins.length; i++) {
    const white = (i % 2 === 0) === whiteMovesFirst;
    const acc = white ? moveAccuracy(wins[i], wins[i + 1]) : moveAccuracy(100 - wins[i], 100 - wins[i + 1]);
    per[white ? 'w' : 'b'].push([acc, weights[i] ?? 1]);
  }
  const side = (xs: [number, number][]) => {
    if (!xs.length) return NaN;
    const weighted = xs.reduce((a, [acc, w]) => a + acc * w, 0) / xs.reduce((a, [, w]) => a + w, 0);
    const harmonic = xs.length / xs.reduce((a, [acc]) => a + 1 / Math.max(1, acc), 0);
    return (weighted + harmonic) / 2;
  };
  return { w: side(per.w), b: side(per.b) };
}

export type Phase = 'opening' | 'middlegame' | 'endgame';
export const PHASES: Phase[] = ['opening', 'middlegame', 'endgame'];

/**
 * Where the middlegame and endgame start, as position indices. A simplified version of lichess's
 * Divider: the middlegame starts once ten or fewer minor and major pieces remain or a back rank
 * thins out (pieces developed); the endgame once six or fewer remain.
 */
export function phaseStarts(game: Game): { middlegame: number; endgame: number } {
  let middlegame = Infinity;
  let endgame = Infinity;
  game.fens.forEach((fen, i) => {
    const board = new Chess(fen).board();
    const pieces = board.flat().filter((sq) => sq && sq.type !== 'p' && sq.type !== 'k').length;
    const backRank = (row: number, color: 'w' | 'b') => board[row].filter((sq) => sq?.color === color).length;
    if (middlegame === Infinity && (pieces <= 10 || backRank(7, 'w') < 4 || backRank(0, 'b') < 4)) middlegame = i;
    if (endgame === Infinity && pieces <= 6) endgame = i;
  });
  return { middlegame: Math.min(middlegame, endgame), endgame };
}

export const phaseOf = (ply: number, starts: { middlegame: number; endgame: number }): Phase =>
  ply >= starts.endgame ? 'endgame' : ply >= starts.middlegame ? 'middlegame' : 'opening';

export interface PlayerStats {
  /** Grade summarising each phase, or null when the player made no moves in it. */
  phases: Record<Phase, Grade | null>;
}

/** Phase grade from the player's mean move accuracy in that phase. */
function phaseGrade(accuracies: number[], grades: Grade[]): Grade | null {
  if (!grades.length) return null;
  if (grades.every((g) => g === 'book' || g === 'forced')) return 'book';
  const mean = accuracies.reduce((a, b) => a + b, 0) / accuracies.length;
  return mean >= 95 ? 'best' : mean >= 85 ? 'excellent' : mean >= 75 ? 'good' : mean >= 60 ? 'inaccuracy' : mean >= 45 ? 'mistake' : 'blunder';
}

/**
 * Per-player phase grades. (No "game rating": a one-game estimate from a lite engine put a
 * 3450 blitz player at 1950, which is worse than showing nothing.)
 */
export function playerStats(game: Game, scores: Score[], moves: (MoveReview | undefined)[]): Record<'w' | 'b', PlayerStats> {
  const starts = phaseStarts(game);
  const out = {} as Record<'w' | 'b', PlayerStats>;
  for (const color of ['w', 'b'] as const) {
    const byPhase: Record<Phase, { acc: number[]; grades: Grade[] }> = {
      opening: { acc: [], grades: [] },
      middlegame: { acc: [], grades: [] },
      endgame: { acc: [], grades: [] },
    };
    game.plies.forEach((ply, i) => {
      const m = moves[i];
      if (ply.color !== color || !m) return;
      const mine = (s: Score) => (color === 'w' ? s.whiteWin : 100 - s.whiteWin);
      const bucket = byPhase[phaseOf(i, starts)];
      bucket.grades.push(m.grade);
      if (m.grade !== 'book' && m.grade !== 'forced') bucket.acc.push(moveAccuracy(mine(scores[i]), mine(scores[i + 1])));
    });
    out[color] = {
      phases: {
        opening: phaseGrade(byPhase.opening.acc, byPhase.opening.grades),
        middlegame: phaseGrade(byPhase.middlegame.acc, byPhase.middlegame.grades),
        endgame: phaseGrade(byPhase.endgame.acc, byPhase.endgame.grades),
      },
    };
  }
  return out;
}
