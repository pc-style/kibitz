import { useEffect, useState } from 'preact/hooks';
import type { MoveReview, Score } from '../review';
import { GRADE_INFO, NOTABLE } from './grades';

interface Props {
  scores: (Score | undefined)[];
  moves: (MoveReview | undefined)[];
  current: number;
  onSelect: (index: number) => void;
}

/** How long the draw-in of a cached review takes; markers pop in as the line reaches them. */
const REVEAL_MS = 700;

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

  // A review that is already complete when the graph mounts (from the cache) draws in from the
  // left once, with markers popping as the line reaches them. During live analysis the graph
  // simply grows and new markers appear immediately.
  const [phase, setPhase] = useState<'closed' | 'revealing' | 'live'>(() => (scores.every(Boolean) ? 'closed' : 'live'));
  useEffect(() => {
    if (phase !== 'closed') return;
    const frame = requestAnimationFrame(() => setPhase('revealing'));
    // Wait for the last marker's pop to finish before dropping the delays.
    const done = setTimeout(() => setPhase('live'), REVEAL_MS + 300);
    return () => {
      cancelAnimationFrame(frame);
      clearTimeout(done);
    };
  }, []);
  const shown = phase === 'closed' || !known.length ? 0 : x(known.length - 1);

  const select = (e: MouseEvent) => {
    const box = (e.currentTarget as HTMLElement).getBoundingClientRect();
    onSelect(Math.round(((e.clientX - box.left) / box.width) * last));
  };

  return (
    <div class="graph" onClick={select} role="img" aria-label="Evaluation over the game; click to jump to a move">
      <svg
        class={`graph-area ${phase === 'revealing' ? 'graph-revealing' : ''}`}
        style={`clip-path:inset(0 ${100 - shown}% 0 0)`}
        viewBox="0 0 100 100"
        preserveAspectRatio="none"
        aria-hidden="true"
      >
        <path d={area} />
      </svg>
      <span class="graph-mid" aria-hidden="true" />
      <span class="graph-cursor" style={`transform:translateX(${x(current)}%)`} aria-hidden="true" />
      <svg class="graph-marks" aria-hidden="true">
        {moves.map((m, i) => {
          const s = scores[i + 1];
          if (!m || !s || !NOTABLE.has(m.grade)) return null;
          // Linear reveal, so a marker's delay matches when the line reaches it.
          const delay = phase === 'live' ? 0 : (x(i + 1) / 100) * REVEAL_MS;
          return (
            <circle
              key={i}
              cx={`${x(i + 1)}%`}
              cy={`${100 - s.whiteWin}%`}
              r="4"
              style={`fill:var(--g-${m.grade});animation-delay:${delay}ms`}
            >
              <title>{GRADE_INFO[m.grade].label}</title>
            </circle>
          );
        })}
      </svg>
    </div>
  );
}
