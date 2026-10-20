import type { Grade } from '../review';

export const GRADE_INFO: Record<Grade, { label: string; glyph: string; phrase: string }> = {
  brilliant: { label: 'Brilliant', glyph: '!!', phrase: 'brilliant' },
  great: { label: 'Great', glyph: '!', phrase: 'a great move' },
  best: { label: 'Best', glyph: '★', phrase: 'the best move' },
  excellent: { label: 'Excellent', glyph: '✓', phrase: 'excellent' },
  good: { label: 'Good', glyph: '✓', phrase: 'good' },
  book: { label: 'Book', glyph: '≡', phrase: 'a book move' },
  inaccuracy: { label: 'Inaccuracy', glyph: '?!', phrase: 'an inaccuracy' },
  mistake: { label: 'Mistake', glyph: '?', phrase: 'a mistake' },
  miss: { label: 'Miss', glyph: '✕', phrase: 'a miss' },
  blunder: { label: 'Blunder', glyph: '??', phrase: 'a blunder' },
  forced: { label: 'Forced', glyph: '□', phrase: 'the only legal move' },
};

/** Grades worth flagging in the move list and on the graph. */
export const NOTABLE: ReadonlySet<Grade> = new Set(['brilliant', 'great', 'inaccuracy', 'mistake', 'miss', 'blunder']);

/** Badge drawn in the top-right corner of a square; the board's custom SVGs use a 100×100 box per square. */
export function badgeSvg(grade: Grade): string {
  const { glyph } = GRADE_INFO[grade];
  const size = glyph.length > 1 ? 15 : 19;
  return (
    `<circle cx="80" cy="20" r="17" style="fill:var(--g-${grade});stroke:var(--board-edge);stroke-width:3"/>` +
    `<text x="80" y="21" text-anchor="middle" dominant-baseline="central" ` +
    `style="fill:var(--g-ink);font:600 ${size}px var(--font-mono)">${glyph}</text>`
  );
}
