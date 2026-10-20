import type { MoveReview, Score } from '../review';
import { GRADE_INFO, NOTABLE } from './grades';

interface Props {
  scores: (Score | undefined)[];
  moves: (MoveReview | undefined)[];
  current: number;
  onSelect: (index: number) => void;
}

/** White's win chance over the game, with notable moves marked where they happened. */
export function EvalGraph({ scores, moves, current, onSelect }: Props) {
  const last = scores.length - 1;
  const x = (i: number) => (last ? (i / last) * 100 : 0);
  // Draw the analysed prefix only; positions finish roughly in order.
  const gap = scores.findIndex((s) => !s);
  const known = (gap === -1 ? scores : scores.slice(0, gap)) as Score[];
  const area = known.length
    ? `M0,100 ${known.map((s, i) => `L${x(i)},${100 - s.whiteWin}`).join(' ')} L${x(known.length - 1)},100 Z`
    : '';

  const select = (e: MouseEvent) => {
    const box = (e.currentTarget as HTMLElement).getBoundingClientRect();
    onSelect(Math.round(((e.clientX - box.left) / box.width) * last));
  };

  return (
    <div class="graph" onClick={select} role="img" aria-label="Evaluation over the game; click to jump to a move">
      <svg class="graph-area" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">
        <path d={area} />
        <line x1="0" x2="100" y1="50" y2="50" />
      </svg>
      <svg class="graph-marks" aria-hidden="true">
        <line class="graph-cursor" x1={`${x(current)}%`} x2={`${x(current)}%`} y1="0" y2="100%" />
        {moves.map((m, i) => {
          const s = scores[i + 1];
          if (!m || !s || !NOTABLE.has(m.grade)) return null;
          return (
            <circle key={i} cx={`${x(i + 1)}%`} cy={`${100 - s.whiteWin}%`} r="4" style={`fill:var(--g-${m.grade})`}>
              <title>{GRADE_INFO[m.grade].label}</title>
            </circle>
          );
        })}
      </svg>
    </div>
  );
}
