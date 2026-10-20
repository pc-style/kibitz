import { Chess, type Square } from 'chess.js';
import { useEffect, useRef } from 'preact/hooks';
import { Piece } from './piece';

/** True when this drag takes a pawn to the last rank, so a piece has to be chosen. */
export function isPromotion(fen: string, orig: string, dest: string): boolean {
  return new Chess(fen).get(orig as Square)?.type === 'p' && (dest[1] === '8' || dest[1] === '1');
}

const CHOICES = [
  { role: 'queen', letter: 'q' },
  { role: 'knight', letter: 'n' },
  { role: 'rook', letter: 'r' },
  { role: 'bishop', letter: 'b' },
] as const;

/**
 * Asks which piece a pawn becomes. Sits over the board (its parent must be positioned) as a column
 * on the promotion file, queen nearest the pawn. Escape or a click outside cancels.
 */
export function PromotionPicker(props: {
  square: string;
  color: 'white' | 'black';
  orientation: 'white' | 'black';
  onPick: (piece: 'q' | 'n' | 'r' | 'b') => void;
  onCancel: () => void;
}) {
  const first = useRef<HTMLButtonElement>(null);
  useEffect(() => first.current?.focus(), []);
  const file = props.square.charCodeAt(0) - 97;
  const col = props.orientation === 'white' ? file : 7 - file;
  const atTop = (props.square[1] === '8') === (props.orientation === 'white');

  return (
    <div class="promotion" onClick={props.onCancel} onKeyDown={(e) => e.key === 'Escape' && props.onCancel()}>
      <div class="promotion-col" role="group" aria-label="Promote to" style={`left:${col * 12.5}%;${atTop ? 'top:0' : 'bottom:0;flex-direction:column-reverse'}`}>
        {CHOICES.map((c, i) => (
          <button
            key={c.letter}
            ref={i === 0 ? first : undefined}
            type="button"
            class="promotion-choice"
            aria-label={c.role}
            onClick={(e) => {
              e.stopPropagation();
              props.onPick(c.letter);
            }}
          >
            <Piece role={c.role} color={props.color} />
          </button>
        ))}
      </div>
    </div>
  );
}
