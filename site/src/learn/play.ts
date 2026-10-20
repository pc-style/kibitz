import type { DrawShape } from '@lichess-org/chessground/draw';
import type { Key } from '@lichess-org/chessground/types';
import { Chess, type Move } from 'chess.js';

/** Practice positions can leave out the kings, which chess.js only accepts unvalidated. */
export const hasKings = (fen: string) => /K/.test(fen.split(' ')[0]) && /k/.test(fen.split(' ')[0]);

export const loadPosition = (fen: string) => new Chess(fen, { skipValidation: !hasKings(fen) });

/** In practice positions only White moves: hand the turn back after every move. */
export function whiteToMove(fen: string): string {
  const fields = fen.split(' ');
  fields[1] = 'w';
  fields[3] = '-';
  return fields.join(' ');
}

export function destsOf(chess: Chess): Map<Key, Key[]> {
  const dests = new Map<Key, Key[]>();
  for (const m of chess.moves({ verbose: true })) {
    const list = dests.get(m.from as Key) ?? [];
    if (!list.includes(m.to as Key)) list.push(m.to as Key);
    dests.set(m.from as Key, list);
  }
  return dests;
}

/** Plays a board drag on chess, promoting to a queen. Null if illegal. */
export function play(chess: Chess, orig: string, dest: string): Move | null {
  try {
    return chess.move({ from: orig, to: dest, promotion: 'q' });
  } catch {
    return null;
  }
}

export function playUci(chess: Chess, uci: string): Move | null {
  try {
    return chess.move({ from: uci.slice(0, 2), to: uci.slice(2, 4), promotion: uci[4] ?? 'q' });
  } catch {
    return null;
  }
}

export const uciOf = (m: Move) => m.from + m.to + (m.promotion ?? '');

export const colorOf = (fen: string): 'white' | 'black' => (fen.split(' ')[1] === 'b' ? 'black' : 'white');

const STAR = (() => {
  const points = Array.from({ length: 10 }, (_, i) => {
    const r = i % 2 ? 14 : 33;
    const a = (Math.PI / 5) * i - Math.PI / 2;
    return `${(50 + r * Math.cos(a)).toFixed(1)},${(52 + r * Math.sin(a)).toFixed(1)}`;
  });
  return `<polygon class="kb-star" points="${points.join(' ')}"/>`;
})();

export const starShape = (sq: string): DrawShape => ({ orig: sq as Key, customSvg: { html: STAR } });
export const dotShape = (sq: string): DrawShape => ({
  orig: sq as Key,
  customSvg: { html: '<circle class="kb-dot" cx="50" cy="50" r="14"/>' },
});
export const arrowShape = (uci: string, brush = 'best'): DrawShape => ({
  orig: uci.slice(0, 2) as Key,
  dest: uci.slice(2, 4) as Key,
  brush,
});
