import type { DrawShape } from '@lichess-org/chessground/draw';
import type { Key } from '@lichess-org/chessground/types';
import type { ComponentChildren } from 'preact';
import { useEffect, useRef } from 'preact/hooks';
import { useSettings } from '../settings';
import { Board, type Movable } from '../ui/board';
import { Piece } from '../ui/piece';
import './learn.css';

/** A lesson-style page: header row, board on the left, coach panel on the right (stacked on phones). */
export function Shell({ title, head, board, intro, children }: { title: string; head?: ComponentChildren; board: ComponentChildren; intro?: boolean; children: ComponentChildren }) {
  return (
    <main class={intro ? 'lesson lesson-intro' : 'lesson'}>
      <div class="lesson-head">
        <a class="lesson-back" href="#/learn">
          ← Course
        </a>
        <h1 class="lesson-title">{title}</h1>
        {head}
      </div>
      <div class="lesson-board">{board}</div>
      <section class="lesson-panel">{children}</section>
    </main>
  );
}

/** Focuses a button for keyboard users without scrolling to it (on phones the explainer's Start sits below the board). */
export const focusQuietly = (el: HTMLElement | null) => el?.focus({ preventScroll: true });

export type Tone = 'neutral' | 'good' | 'bad';

/** The knight coach from the review, saying what to do and how it went. */
export function Coach({ tone = 'neutral', lead, children }: { tone?: Tone; lead: string; children?: ComponentChildren }) {
  const g = tone === 'good' ? 'var(--g-best)' : tone === 'bad' ? 'var(--g-mistake)' : undefined;
  return (
    <div class="coach lesson-coach" style={g ? `--g:${g}` : undefined}>
      <Piece role="knight" color="white" class="coach-avatar" />
      <div class="coach-body" key={lead} aria-live="polite">
        <p class="coach-lead">{lead}</p>
        {children}
      </div>
    </div>
  );
}

export function LessonBoard(props: {
  fen: string;
  orientation?: 'white' | 'black';
  lastMove?: Key[];
  shapes: DrawShape[];
  movable?: Movable;
  /** Drawn over the board, e.g. the promotion picker. */
  overlay?: ComponentChildren;
}) {
  const settings = useSettings();
  return (
    <div class="board lesson-board-inner">
      <Board
        fen={props.fen}
        orientation={props.orientation ?? 'white'}
        lastMove={props.lastMove}
        shapes={props.shapes}
        movable={props.movable}
        coordinates={settings.coordinates}
        animate={settings.motion}
      />
      {props.overlay}
    </div>
  );
}

/** Schedules timeouts that are cleared when the component unmounts. */
export function useLater() {
  const ids = useRef<number[]>([]);
  useEffect(() => () => ids.current.forEach((t) => clearTimeout(t)), []);
  return (fn: () => void, ms: number) => void ids.current.push(window.setTimeout(fn, ms));
}

export const Stars = ({ count, of = 3, small }: { count: number; of?: number; small?: boolean }) => (
  <span class={`stars ${small ? 'stars-small' : ''}`} role="img" aria-label={`${count} of ${of} stars`}>
    {Array.from({ length: of }, (_, i) => (
      <span key={i} class={i < count ? 'star star-on' : 'star'} style={`--i:${i}`} aria-hidden="true">
        ★
      </span>
    ))}
  </span>
);
