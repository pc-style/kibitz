import { Chess } from 'chess.js';
import type { SearchResult } from '../engine';

export type Side = 'white' | 'black';

export interface Bot {
  id: string;
  name: string;
  level: string;
  description: string;
  piece: 'pawn' | 'knight' | 'rook' | 'queen' | 'king';
  skill: number;
  depth: number;
  moveTime: number;
  random: number;
}

// Difficulty is relative, not a claim of a human Elo rating. Even Skill 0 needs
// extra mistakes to give a new player a forgiving opponent.
export const BOTS: Bot[] = [
  { id: 'pip', name: 'Pip', level: 'Beginner', description: 'Still learning. Misses threats and gives you chances.', piece: 'pawn', skill: 0, depth: 5, moveTime: 300, random: 0.45 },
  { id: 'scout', name: 'Scout', level: 'Easy', description: 'Finds good moves, but sometimes gets distracted.', piece: 'knight', skill: 2, depth: 8, moveTime: 500, random: 0.15 },
  { id: 'rook', name: 'Rook', level: 'Medium', description: 'A steadier opponent. Keep your pieces protected.', piece: 'rook', skill: 6, depth: 12, moveTime: 700, random: 0 },
  { id: 'sage', name: 'Sage', level: 'Hard', description: 'Looks further ahead and lets fewer mistakes slide.', piece: 'queen', skill: 14, depth: 18, moveTime: 1100, random: 0 },
  { id: 'stockfish', name: 'Stockfish', level: 'Expert', description: 'Full skill, with up to 1.5 seconds to find each move.', piece: 'king', skill: 20, depth: 24, moveTime: 1500, random: 0 },
];

export function botMove(chess: Chess, result: SearchResult, bot: Bot, random = Math.random): string | undefined {
  const moves = chess.moves({ verbose: true });
  if (!moves.length) return undefined;
  // The forgiving bots still take an immediate checkmate when they see one.
  const mate = moves.find((move) => move.san.endsWith('#'));
  if (mate) return mate.lan;
  if (bot.random && random() < bot.random) return moves[Math.floor(random() * moves.length)].lan;
  // Skill Level chooses bestmove; PV 1 is the strongest line, not the weakened move.
  return result.best;
}

export function gameEnding(chess: Chess, side: Side, resigned: boolean): { title: string; detail: string; result: string } | null {
  if (resigned) return { title: 'You resigned.', detail: 'Review the game to find your next thing to work on.', result: side === 'white' ? '0-1' : '1-0' };
  if (chess.isCheckmate()) {
    const won = chess.turn() !== side[0];
    return { title: won ? 'Checkmate. You won!' : 'Checkmate. The bot won.', detail: 'See which moves made the difference in the review.', result: chess.turn() === 'w' ? '0-1' : '1-0' };
  }
  const detail = chess.isStalemate() ? 'Stalemate: no legal moves, and the king is not in check.'
    : chess.isInsufficientMaterial() ? 'Neither side has enough material to checkmate.'
    : chess.isThreefoldRepetition() ? 'The same position occurred three times.'
    : chess.isDrawByFiftyMoves() ? 'Fifty moves each without a pawn move or capture.' : null;
  return detail ? { title: 'A draw.', detail, result: '1/2-1/2' } : null;
}

/** Undo the player's last move and any reply, preserving Black's opening reply. */
export function takeBack(chess: Chess, side: Side): boolean {
  if (!chess.history({ verbose: true }).some((move) => move.color === side[0])) return false;
  chess.undo();
  if (chess.turn() !== side[0]) chess.undo();
  return true;
}

export function gamePgn(chess: Chess, bot: Bot, side: Side, result: string): string {
  const copy = new Chess();
  copy.loadPgn(chess.pgn());
  copy.setHeader('Event', 'Kibitz bot game');
  copy.setHeader('White', side === 'white' ? 'You' : bot.name);
  copy.setHeader('Black', side === 'black' ? 'You' : bot.name);
  copy.setHeader('Result', result);
  return copy.pgn();
}

/** The game in progress, kept in the browser so leaving Play (or reloading) doesn't lose it. */
export interface SavedGame { bot: string; side: Side; moves: string[]; date: string }

const SAVE_KEY = 'kibitz:bot-game';

export function loadSavedGame(): { bot: Bot; side: Side; moves: string[]; date: string } | null {
  try {
    const saved = JSON.parse(localStorage.getItem(SAVE_KEY) ?? 'null') as SavedGame | null;
    const bot = BOTS.find((b) => b.id === saved?.bot);
    if (!saved || !bot || (saved.side !== 'white' && saved.side !== 'black') || !Array.isArray(saved.moves)) return null;
    return { bot, side: saved.side, moves: saved.moves.filter((m) => typeof m === 'string'), date: String(saved.date ?? '') };
  } catch {
    return null;
  }
}

export function saveGame(game: SavedGame | null) {
  try {
    if (game) localStorage.setItem(SAVE_KEY, JSON.stringify(game));
    else localStorage.removeItem(SAVE_KEY);
  } catch {
    // Storage is off or full: the game still plays, it just won't survive leaving the page.
  }
}
