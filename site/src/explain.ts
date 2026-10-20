import { Chess, type Color, type PieceSymbol } from 'chess.js';
import type { Line, PositionEval } from './engine';
import type { Game } from './game';
import { VALUE, type Grade, type MoveReview } from './review';

export interface Explanation {
  lead: string;
  detail?: string;
}

const SIDE: Record<Color, string> = { w: 'White', b: 'Black' };
const PIECE: Record<PieceSymbol, string> = { p: 'pawn', n: 'knight', b: 'bishop', r: 'rook', q: 'queen', k: 'king' };
const other = (c: Color): Color => (c === 'w' ? 'b' : 'w');

export const moveName = (game: Game, i: number) => {
  const p = game.plies[i];
  return `${p.moveNumber}${p.color === 'w' ? '.' : '…'} ${p.san}`;
};

function material(chess: Chess, color: Color): number {
  return chess
    .board()
    .flat()
    .reduce((sum, sq) => sum + (sq && sq.color === color ? VALUE[sq.type] : 0), 0);
}

/**
 * Plays the first few moves of an engine line and reports how material moved for `side`:
 * positive is a gain. Also returns the first move in SAN and the biggest piece `side` loses or wins.
 */
function followLine(fen: string, pv: string[], side: Color, plies = 4) {
  const chess = new Chess(fen);
  const start = material(chess, side) - material(chess, other(side));
  let first: string | undefined;
  let lost: PieceSymbol | undefined;
  let won: PieceSymbol | undefined;
  for (const uci of pv.slice(0, plies)) {
    try {
      const m = chess.move({ from: uci.slice(0, 2), to: uci.slice(2, 4), promotion: uci[4] });
      first ??= m.san;
      if (m.captured && m.color !== side && (!lost || VALUE[m.captured] > VALUE[lost])) lost = m.captured;
      if (m.captured && m.color === side && (!won || VALUE[m.captured] > VALUE[won])) won = m.captured;
    } catch {
      break;
    }
  }
  return { swing: material(chess, side) - material(chess, other(side)) - start, first, lost, won };
}

/** Mate in n for the side to move on this line, if any. */
const mateIn = (line?: Line) => (line?.mate !== undefined && line.mate > 0 ? line.mate : undefined);

const standing = (win: number) => (win >= 60 ? 'keeps the advantage' : win >= 40 ? 'holds the balance' : 'keeps the game alive');

/** A plain-language comment for ply `i`, built from the engine lines before and after it. */
export function explainMove(
  game: Game,
  i: number,
  review: MoveReview,
  evals: (PositionEval | undefined)[],
  winAfter: number,
  opening?: string,
): Explanation {
  const ply = game.plies[i];
  const me = ply.color;
  const them = other(me);
  const san = ply.san;
  const before = evals[i]?.lines ?? [];
  const after = evals[i + 1]?.lines ?? [];
  const last = i === game.plies.length - 1;

  if (last && game.ending === 'mate') return { lead: `${san} is checkmate.`, detail: `${SIDE[me]} wins the game.` };
  if (last && game.ending === 'draw') return { lead: `${san} ends the game in a draw.` };

  const youHadMate = mateIn(before[0]);
  const theyHaveMate = mateIn(after[0]);
  const reply = after[0] ? followLine(ply.fenAfter, after[0].pv, me) : undefined;
  const chance = before[0] ? followLine(ply.fenBefore, before[0].pv, me) : undefined;

  switch (review.grade as Grade) {
    case 'book':
      return { lead: `${san} is a book move.`, detail: opening };
    case 'forced':
      return { lead: `${san} was the only legal move.` };
    case 'brilliant': {
      const piece = review.sacrificed ? `the ${PIECE[review.sacrificed]}` : 'material';
      return {
        lead: `${san} is brilliant!`,
        detail: winAfter === 100 ? `It gives up ${piece}, and mate follows.` : `It gives up ${piece}, and ${SIDE[them]} can't safely take it.`,
      };
    }
    case 'great':
      return { lead: `${san} is a great move.`, detail: `It's the only move that ${standing(winAfter)}.` };
    case 'best': {
      const mating = after[0]?.mate !== undefined && after[0].mate < 0 ? -after[0].mate : undefined;
      return { lead: `${san} is the best move.`, detail: mating ? `${SIDE[me]} has mate in ${mating}.` : undefined };
    }
    case 'excellent':
      return { lead: `${san} is excellent.`, detail: review.best ? `Nearly as strong as ${review.best}.` : undefined };
    case 'good':
      return { lead: `${san} is good.`, detail: review.best ? `${review.best} was a little stronger.` : undefined };
  }

  // Inaccuracies, mistakes, misses and blunders: say what went wrong, most concrete reason first.
  const lead = `${san} is ${review.grade === 'inaccuracy' ? 'an inaccuracy' : `a ${review.grade}`}.`;
  if (theyHaveMate) {
    const start = reply?.first ? `, starting with ${reply.first}` : '';
    return { lead, detail: `It allows ${SIDE[them]} to force mate in ${theyHaveMate}${start}.` };
  }
  if (youHadMate && review.best) return { lead, detail: `${review.best} would have forced mate in ${youHadMate}.` };
  if (reply && reply.swing <= -2 && reply.first) {
    const what = reply.lost && reply.lost !== 'p' ? `win the ${PIECE[reply.lost]}` : 'win material';
    return { lead, detail: `${SIDE[them]} can ${what} with ${reply.first}.` };
  }
  if (chance && chance.swing >= 2 && review.best) {
    const what = chance.won && chance.won !== 'p' ? `won the ${PIECE[chance.won]}` : 'won material';
    return { lead, detail: `${review.best} would have ${what}.` };
  }
  if (review.grade === 'miss' && review.best) return { lead, detail: `${review.best} would have kept a winning position.` };
  // No simple tactic to point at: name the reply that punishes it (the best move is shown below anyway).
  if (reply?.first && review.grade !== 'inaccuracy') {
    const verdict = winAfter < 20 ? ' and should win' : winAfter < 35 ? ' and is clearly better' : winAfter < 45 ? ' and takes over' : '';
    return { lead, detail: `${SIDE[them]} answers ${reply.first}${verdict}.` };
  }
  return { lead, detail: review.best ? `${review.best} was more precise.` : undefined };
}

/** One or two sentences on the whole game, for the top of the summary. */
export function summarizeGame(
  game: Game,
  moves: (MoveReview | undefined)[],
  accuracy: { w: number; b: number },
  names: Record<Color, string>,
): string {
  const gap = accuracy.w - accuracy.b;
  const parts = [Math.abs(gap) < 3 ? 'Both sides played at a similar level.' : `${names[gap > 0 ? 'w' : 'b']} played the more accurate game.`];

  const brilliant = moves.findIndex((m) => m?.grade === 'brilliant');
  if (brilliant >= 0) {
    parts.push(`${names[game.plies[brilliant].color]} found a brilliant ${moveName(game, brilliant)}.`);
  } else {
    let worst = -1;
    moves.forEach((m, i) => {
      if (m && (m.grade === 'blunder' || m.grade === 'mistake' || m.grade === 'miss') && (worst < 0 || m.loss > moves[worst]!.loss)) worst = i;
    });
    if (worst >= 0) parts.push(`The turning point was ${moveName(game, worst)}, ${moves[worst]!.grade === 'miss' ? 'a missed chance' : `a ${moves[worst]!.grade}`}.`);
  }
  if (game.ending === 'mate') parts.push('It ended in checkmate.');
  return parts.join(' ');
}
