import { createElement } from 'preact';

/** A chess piece drawn with the board's own piece set (chessground's `.cg-wrap piece` images). */
export function Piece({ role, color, class: cls }: { role: 'pawn' | 'knight' | 'king'; color: 'white' | 'black'; class?: string }) {
  return (
    <span class={`cg-wrap piece-icon ${cls ?? ''}`} aria-hidden="true">
      {createElement('piece', { class: `${role} ${color}` })}
    </span>
  );
}
