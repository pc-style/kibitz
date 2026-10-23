import { Chess } from 'chess.js';
import type { ComponentChildren } from 'preact';
import type { Puzzle } from './data';
import './puzzles.css';

/** Board on the left, panel on the right (panel first on phones), under a header row with the way back. */
export function PuzzleShell(props: {
  title: string;
  aside?: ComponentChildren;
  board: ComponentChildren;
  children: ComponentChildren;
  /** Where ← goes; `onClick` is for a view inside the same page (practising your mistakes), which has no URL of its own. */
  back?: { href: string; label: string; onClick?: () => void };
}) {
  const back = props.back ?? { href: '#/puzzles', label: 'Puzzles' };
  const onBack = back.onClick;
  return (
    <main class="puzzle-page">
      <div class="puzzle-head">
        <a
          class="lesson-back"
          href={back.href}
          onClick={
            onBack
              ? (e) => {
                  e.preventDefault();
                  onBack();
                }
              : undefined
          }
        >
          ← {back.label}
        </a>
        <h1 class="puzzle-title">{props.title}</h1>
        {props.aside}
      </div>
      <div class="puzzle-board-area">{props.board}</div>
      <section class="puzzle-panel">{props.children}</section>
    </main>
  );
}

export function Missing({ title, detail, children }: { title: string; detail?: string; children?: ComponentChildren }) {
  return (
    <main class="notice">
      <h1>{title}</h1>
      {detail ? <p>{detail}</p> : null}
      {children}
      <a class="button" href="#/puzzles">
        Back to Puzzles
      </a>
    </main>
  );
}

export function afterSetup(puzzle: Puzzle): string {
  try {
    return new Chess(puzzle.fen).move({ from: puzzle.moves[0].slice(0, 2), to: puzzle.moves[0].slice(2, 4), promotion: puzzle.moves[0][4] }).after;
  } catch {
    return puzzle.fen;
  }
}

