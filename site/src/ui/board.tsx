import { Chessground } from '@lichess-org/chessground';
import type { Api } from '@lichess-org/chessground/api';
import type { DrawShape } from '@lichess-org/chessground/draw';
import type { Key } from '@lichess-org/chessground/types';
import { useEffect, useRef } from 'preact/hooks';
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
}

export function Board({ fen, orientation, lastMove, shapes, movable, coordinates = true, animate = true }: Props) {
  const el = useRef<HTMLDivElement>(null);
  const api = useRef<Api | null>(null);
  const onMove = useRef(movable?.onMove);
  onMove.current = movable?.onMove;

  useEffect(() => {
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
    return () => cg.destroy();
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

  useEffect(() => {
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

  return <div ref={el} class={`cg-wrap ${movable ? 'cg-movable' : ''}`} />;
}
