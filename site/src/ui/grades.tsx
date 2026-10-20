import type { Grade } from '../review';

export const GRADE_INFO: Record<Grade, { label: string; phrase: string }> = {
  brilliant: { label: 'Brilliant', phrase: 'brilliant' },
  great: { label: 'Great', phrase: 'a great move' },
  best: { label: 'Best', phrase: 'the best move' },
  excellent: { label: 'Excellent', phrase: 'excellent' },
  good: { label: 'Good', phrase: 'good' },
  book: { label: 'Book', phrase: 'a book move' },
  inaccuracy: { label: 'Inaccuracy', phrase: 'an inaccuracy' },
  mistake: { label: 'Mistake', phrase: 'a mistake' },
  miss: { label: 'Miss', phrase: 'a miss' },
  blunder: { label: 'Blunder', phrase: 'a blunder' },
  forced: { label: 'Forced', phrase: 'the only legal move' },
};

/** Grades worth flagging in the move list and on the graph. */
export const NOTABLE: ReadonlySet<Grade> = new Set(['brilliant', 'great', 'inaccuracy', 'mistake', 'miss', 'blunder']);

function starPath(cx: number, cy: number, outer: number, inner: number): string {
  let d = '';
  for (let i = 0; i < 10; i++) {
    const a = -Math.PI / 2 + (i * Math.PI) / 5;
    const r = i % 2 ? inner : outer;
    d += `${i ? 'L' : 'M'}${(cx + r * Math.cos(a)).toFixed(2)} ${(cy + r * Math.sin(a)).toFixed(2)}`;
  }
  return `${d}Z`;
}

const text = (s: string, size: number) =>
  `<text x="12" y="12.6" text-anchor="middle" dominant-baseline="central" fill="currentColor" ` +
  `style="font:600 ${size}px var(--font-mono);letter-spacing:-0.1em">${s}</text>`;
const stroke = 'fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round"';

/**
 * One symbol per grade in a 24×24 box, drawn in currentColor. Informator glyphs stay as type;
 * the engine-only grades get small drawn marks so they render the same in every font.
 */
const GLYPHS: Record<Grade, string> = {
  brilliant: text('!!', 15),
  great: text('!', 17),
  best: `<path d="${starPath(12, 12.8, 7.6, 3.3)}" fill="currentColor"/>`,
  excellent: `<path d="M5.5 11h2.6v7.5H5.5zM9.6 18.5V11l3.2-4.6c.6-.8 1.9-.4 1.9.6V10h3.1c.9 0 1.6.9 1.4 1.8l-1.2 5.3c-.2.8-.9 1.4-1.7 1.4z" fill="currentColor"/>`,
  good: `<path d="M6.8 12.6l3.4 3.4 7-7.6" ${stroke} stroke-width="2.6"/>`,
  book: `<path d="M5 7.6c2.6-1.2 4.8-1 7 .6v9.4c-2.2-1.6-4.4-1.8-7-.6zM19 7.6c-2.6-1.2-4.8-1-7 .6v9.4c2.2-1.6 4.4-1.8 7-.6z" fill="currentColor"/>`,
  inaccuracy: text('?!', 14),
  mistake: text('?', 17),
  miss: `<path d="M7.8 7.8l8.4 8.4M16.2 7.8l-8.4 8.4" ${stroke} stroke-width="2.6"/>`,
  blunder: text('??', 14),
  forced: `<rect x="7.2" y="7.2" width="9.6" height="9.6" rx="1.5" ${stroke} stroke-width="2.3"/>`,
};

export function GradeIcon({ grade, solid }: { grade: Grade; solid?: boolean }) {
  return (
    <svg
      class={solid ? 'gi gi-solid' : 'gi'}
      style={`--g:var(--g-${grade})`}
      viewBox="0 0 24 24"
      aria-hidden="true"
      dangerouslySetInnerHTML={{ __html: GLYPHS[grade] }}
    />
  );
}

/** Badge in the top-right corner of a square; the board's custom SVGs use a 100×100 box per square. */
export function badgeSvg(grade: Grade): string {
  return (
    `<g class="kb-badge">` +
    `<circle cx="80" cy="20" r="17" style="fill:var(--g-${grade});stroke:var(--board-edge);stroke-width:3"/>` +
    `<g transform="translate(66.5 6.5) scale(1.125)" style="color:var(--g-ink)">${GLYPHS[grade]}</g>` +
    `</g>`
  );
}
