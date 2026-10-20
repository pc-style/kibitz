import { Chessground } from '@lichess-org/chessground';
import type { Api } from '@lichess-org/chessground/api';
import type { DrawShape } from '@lichess-org/chessground/draw';
import type { Key } from '@lichess-org/chessground/types';
import { useEffect, useRef } from 'preact/hooks';

interface Props {
  fen: string;
  orientation: 'white' | 'black';
  lastMove?: Key[];
  shapes: DrawShape[];
}

export function Board({ fen, orientation, lastMove, shapes }: Props) {
  const el = useRef<HTMLDivElement>(null);
  const api = useRef<Api | null>(null);

  useEffect(() => {
    const cg = Chessground(el.current!, {
      viewOnly: true,
      coordinates: true,
      animation: { enabled: true, duration: 180 },
      drawable: { enabled: false, visible: true },
    });
    cg.state.drawable.brushes.best = { key: 'kb', color: '#5fbf7a', opacity: 0.85, lineWidth: 12 };
    api.current = cg;
    return () => cg.destroy();
  }, []);

  useEffect(() => {
    api.current?.set({ fen, orientation, lastMove });
    api.current?.setAutoShapes(shapes);
  }, [fen, orientation, lastMove?.join(), shapes]);

  return <div ref={el} class="cg-wrap" />;
}
