import { Chessground } from '@lichess-org/chessground';
import { Chess } from 'chess.js';
import type { Api } from '@lichess-org/chessground/api';
import type { DrawShape } from '@lichess-org/chessground/draw';
import type { Key } from '@lichess-org/chessground/types';
import { useEffect, useLayoutEffect, useRef, useState } from 'preact/hooks';
import { reducedMotion } from './theme';

export interface Movable {
  color: 'white' | 'black';
  dests: Map<Key, Key[]>;
  onMove: (orig: Key, dest: Key) => void;
}

interface Props {
  fen: string;
  orientation: 'white' | 'black';
  lastMove?: Key[];
  shapes: DrawShape[];
  /** Lets the user play one move (Retry); otherwise the board only displays. */
  movable?: Movable;
  coordinates?: boolean;
  animate?: boolean;
  /** Adds a field for typing moves (e4, Nf3, e2e4), hidden until it has keyboard focus. */
  typing?: boolean;
}

export function Board({ fen, orientation, lastMove, shapes, movable, coordinates = true, animate = true, typing = false }: Props) {
  const el = useRef<HTMLDivElement>(null);
  const api = useRef<Api | null>(null);
  const onMove = useRef(movable?.onMove);
  onMove.current = movable?.onMove;

  // Created before paint and before the sync below, which runs in the same pass on the first render.
  useLayoutEffect(() => {
    // Not viewOnly: chessground binds pointer events only at creation, and Retry needs them later.
    // With no movable color nothing can be moved, so it still behaves as a display.
    const cg = Chessground(el.current!, {
      coordinates,
      // Piece slides run in JS, so the CSS reduced-motion rule can't reach them.
      animation: { enabled: !reducedMotion(), duration: 180 },
      premovable: { enabled: false },
      drawable: { enabled: false, visible: true },
      movable: { free: false, showDests: true, events: { after: (orig, dest) => onMove.current?.(orig, dest) } },
    });
    cg.state.drawable.brushes.best = { key: 'kb', color: '#5fbf7a', opacity: 0.85, lineWidth: 12 };
    api.current = cg;
    // Chessground remembers where the board is and re-measures only on scroll and window resize. When
    // something above it changes height (a lesson's feedback on phones), taps would land on the wrong
    // squares; measuring again as each touch or click starts keeps them true.
    const wrap = el.current!;
    const measure = () => cg.state.dom.bounds.clear();
    wrap.addEventListener('touchstart', measure, { capture: true, passive: true });
    wrap.addEventListener('mousedown', measure, { capture: true });
    return () => {
      wrap.removeEventListener('touchstart', measure, { capture: true });
      wrap.removeEventListener('mousedown', measure, { capture: true });
      cg.destroy();
    };
  }, []);

  // Coordinates are drawn when the board is built, so toggling them needs a full redraw.
  useEffect(() => {
    if (!api.current || api.current.state.coordinates === coordinates) return;
    api.current.set({ coordinates });
    api.current.redrawAll();
  }, [coordinates]);

  useEffect(() => {
    api.current?.set({ animation: { enabled: animate && !reducedMotion() } });
  }, [animate]);

  // Before paint, so the board takes moves from the same frame that says "Your move" (no click lost in between).
  useLayoutEffect(() => {
    api.current?.set({
      fen,
      orientation,
      lastMove,
      turnColor: movable?.color ?? (fen.split(' ')[1] === 'b' ? 'black' : 'white'),
      selectable: { enabled: !!movable },
      movable: { color: movable?.color, dests: movable?.dests ?? new Map() },
    });
    api.current?.setAutoShapes(shapes);
  }, [fen, orientation, lastMove?.join(), shapes, movable]);

  return (
    <>
      <div ref={el} class={`cg-wrap ${movable ? 'cg-movable' : ''}`} role="img" aria-label={describe(fen)} />
      {typing ? <MoveEntry fen={fen} movable={movable} /> : null}
    </>
  );
}

const NAMES: Record<string, string> = { k: 'king', q: 'queen', r: 'rook', b: 'bishop', n: 'knight', p: 'pawn' };

/** The position in words, for screen readers: "White: king e1, rook a1. Black: king e8." */
function describe(fen: string): string {
  const side: Record<'w' | 'b', string[]> = { w: [], b: [] };
  fen
    .split(' ')[0]
    .split('/')
    .forEach((row, r) => {
      let file = 0;
      for (const ch of row) {
        if (/\d/.test(ch)) file += Number(ch);
        else side[ch === ch.toUpperCase() ? 'w' : 'b'].push(`${NAMES[ch.toLowerCase()]} ${'abcdefgh'[file++]}${8 - r}`);
      }
    });
  return `Chess board. White: ${side.w.join(', ') || 'no pieces'}. Black: ${side.b.join(', ') || 'no pieces'}.`;
}

/** Reads "e4", "Nxf7+", "O-O", "e2e4" or "e2-e4" as a move for the side that can move. */
function parseMove(fen: string, color: 'white' | 'black', text: string): { from: Key; to: Key } | null {
  const t = text.trim().replace(/\s+/g, '');
  const coord = /^([a-h][1-8])-?([a-h][1-8])[qrbn]?$/i.exec(t);
  if (coord) return { from: coord[1].toLowerCase() as Key, to: coord[2].toLowerCase() as Key };
  try {
    // Lesson positions may have no kings, so no validation; the side to move is whoever may move here.
    const parts = fen.split(' ');
    parts[1] = color[0];
    const m = new Chess(parts.join(' '), { skipValidation: true }).move(t.replace(/^0-0(-0)?/, (c) => c.replaceAll('0', 'O')));
    return { from: m.from as Key, to: m.to as Key };
  } catch {
    return null;
  }
}

/**
 * Keyboard and screen-reader play: a field under the board that appears when tabbed to. It stays mounted
 * between turns so focus isn't lost after each move.
 */
function MoveEntry({ fen, movable }: { fen: string; movable?: Movable }) {
  const [text, setText] = useState('');
  const [error, setError] = useState('');
  const submit = (e: Event) => {
    e.preventDefault();
    if (!text.trim()) return;
    if (!movable) return setError("You can't move right now.");
    const m = parseMove(fen, movable.color, text);
    if (!m || !movable.dests.get(m.from)?.includes(m.to)) return setError(`${text.trim()} isn't a legal move here. Try one like e4, Nf3 or e2e4.`);
    setText('');
    setError('');
    movable.onMove(m.from, m.to);
  };
  return (
    <form class="move-entry" onSubmit={submit}>
      <label>
        <span>Type a move</span>
        <input
          value={text}
          onInput={(e) => {
            setText(e.currentTarget.value);
            setError('');
          }}
          placeholder="e4, Nf3, e2e4…"
          spellcheck={false}
          autocomplete="off"
          autocapitalize="off"
          enterkeyhint="go"
        />
      </label>
      <p class="move-entry-error" role="alert">
        {error}
      </p>
    </form>
  );
}
