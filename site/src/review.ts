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
/** At or above this the mover is already winning, so nothing is brilliant or great. */
const DECIDED = 92;
/** A brilliant sacrifice can't leave the mover worse off than this. */
const STILL_FINE = 35;
/** Material (in pawns) a sacrifice must leave en prise after counting what it captured. */
const SACRIFICE = 2;
/** After the opponent's mistake, losing this much of the chance you were given is a miss. */
const MISS_AFTER_OPPONENT = INACCURACY;

const VALUE: Record<PieceSymbol, number> = { p: 1, n: 3, b: 3, r: 5, q: 9, k: 0 };

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
}

export const winChance = (cp: number) => 50 + 50 * (2 / (1 + Math.exp(-0.00368208 * clamp(cp, -1000, 1000))) - 1);

const clamp = (x: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, x));

/** Win chance of a line for the side to move. */
const lineWin = (line: Line) => (line.mate !== undefined ? (line.mate > 0 ? 100 : 0) : winChance(line.cp ?? 0));

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

/** True when the move leaves at least a minor piece's worth of material en prise, net of what it took. */
function isSacrifice(ply: Ply): boolean {
  const chess = new Chess(ply.fenAfter);
  let atStake = 0;
  for (const reply of chess.moves({ verbose: true })) {
    if (!reply.captured || reply.captured === 'p') continue;
    const defended = chess.attackers(reply.to, ply.color).length > 0;
    atStake = Math.max(atStake, VALUE[reply.captured] - (defended ? VALUE[reply.piece] : 0));
  }
  return atStake - (ply.captured ? VALUE[ply.captured] : 0) >= SACRIFICE;
}

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
    const winAfter = mine(after);
    const loss = Math.max(0, winBefore - winAfter);
    const isBest = ply.uci === lines[0].pv[0];
    const gap = lines[1] ? lineWin(lines[0]) - lineWin(lines[1]) : 0;
    const prev = moves[i - 1];

    let grade: Grade;
    if ((isBest || loss <= EXCELLENT) && winBefore < DECIDED && winAfter >= STILL_FINE && isSacrifice(ply)) grade = 'brilliant';
    else if (isBest && gap >= GREAT_GAP && winBefore < DECIDED && !isRecapture(ply, game.plies[i - 1])) grade = 'great';
    else if (isBest) grade = 'best';
    else if (loss <= EXCELLENT) grade = 'excellent';
    else if (loss <= GOOD) grade = 'good';
    else if (loss <= INACCURACY) grade = 'inaccuracy';
    else if (loss <= MISTAKE) grade = 'mistake';
    else grade = 'blunder';

    const opponentErred = prev?.grade === 'mistake' || prev?.grade === 'blunder';
    if (!isBest && opponentErred && loss >= MISS_AFTER_OPPONENT && winAfter >= 30) grade = 'miss';

    const review: MoveReview = { grade, loss };
    if (!isBest) {
      review.bestLine = lineToSan(ply.fenBefore, lines[0].pv);
      review.best = review.bestLine[0];
    }
    moves.push(review);
  });

  return { scores, moves };
}

/** lichess's per-move accuracy from win chances before and after the move. */
function moveAccuracy(before: number, after: number): number {
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
