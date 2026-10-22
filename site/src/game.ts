import { Chess, type Color, type PieceSymbol, type Square } from 'chess.js';

export interface Ply {
  san: string;
  uci: string;
  from: Square;
  to: Square;
  color: Color;
  piece: PieceSymbol;
  captured?: PieceSymbol;
  fenBefore: string;
  fenAfter: string;
  moveNumber: number;
  legalCount: number;
}

export interface Game {
  headers: Record<string, string>;
  plies: Ply[];
  /** Position before each ply, plus the final position: plies.length + 1 entries. */
  fens: string[];
  /** How the final position ended on the board, if it did. */
  ending: 'mate' | 'draw' | null;
}

export function parseGame(pgn: string): Game {
  const chess = new Chess();
  try {
    chess.loadPgn(pgn.trim(), { strict: false });
  } catch (err) {
    throw new Error(`Couldn't read that PGN: ${err instanceof Error ? err.message : String(err)}`);
  }
  const headers = chess.getHeaders();
  const variant = headers.Variant?.toLowerCase();
  if (variant && variant !== 'standard' && variant !== 'from position') {
    throw new Error(`${headers.Variant} isn't supported yet, only standard chess.`);
  }
  const history = chess.history({ verbose: true });
  if (!history.length) throw new Error('That game has no moves to review.');

  const plies = history.map((m): Ply => {
    const before = new Chess(m.before);
    return {
      san: m.san,
      uci: m.lan,
      from: m.from,
      to: m.to,
      color: m.color,
      piece: m.piece,
      captured: m.captured,
      fenBefore: m.before,
      fenAfter: m.after,
      moveNumber: before.moveNumber(),
      legalCount: before.moves().length,
    };
  });
  // isDraw covers stalemate, bare kings, threefold repetition and the fifty-move rule.
  const ending = chess.isCheckmate() ? 'mate' : chess.isDraw() ? 'draw' : null;
  return { headers, plies, fens: [history[0].before, ...history.map((m) => m.after)], ending };
}

/** Position key without move counters, used for opening-book lookups. */
export const epd = (fen: string) => fen.split(' ').slice(0, 4).join(' ');

export const sideToMove = (fen: string): Color => (fen.split(' ')[1] === 'b' ? 'b' : 'w');

export function uciToSan(fen: string, uci: string): string | undefined {
  try {
    return new Chess(fen).move({ from: uci.slice(0, 2), to: uci.slice(2, 4), promotion: uci[4] }).san;
  } catch {
    return undefined;
  }
}

/** Converts an engine line to SAN, stopping at the first move that doesn't parse. */
export function lineToSan(fen: string, uciMoves: string[], max = 6): string[] {
  const chess = new Chess(fen);
  const out: string[] = [];
  for (const uci of uciMoves.slice(0, max)) {
    try {
      out.push(chess.move({ from: uci.slice(0, 2), to: uci.slice(2, 4), promotion: uci[4] }).san);
    } catch {
      break;
    }
  }
  return out;
}
