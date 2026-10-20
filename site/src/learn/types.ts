/**
 * The course format. A lesson is a short explainer with a demo board, then a few hands-on tasks.
 * Squares are lowercase algebraic ('e4'), moves are UCI ('e2e4', 'e7e8q' for promotion).
 * Every FEN is a full six-field FEN. Practice positions may leave out the kings (see `collect`).
 */

/** A board that plays itself while the explainer is read. */
export interface Demo {
  fen: string;
  /** Played one by one, then the board resets and loops. Leave out for a still picture. */
  moves?: string[];
  /** Dots on squares, e.g. everywhere the piece can go. Shown on the starting position. */
  dots?: string[];
  /** Arrows as UCI pairs ('e2e4'). Shown on the starting position. */
  arrows?: string[];
}

export interface Intro {
  /** One to three short paragraphs. Plain words; name a chess term the first time it is used. */
  text: string[];
  demo: Demo;
}

interface TaskBase {
  /** The goal in one line, shown above the board: "Take every star with the rook." */
  prompt: string;
  fen: string;
  /** Shown once the task is solved, to say why it worked. Optional. */
  explain?: string;
  /** Shown after a wrong try. Optional. */
  hint?: string;
  /** The move just played (UCI), highlighted on the board: a pawn's two-square jump before en passant, say. */
  lastMove?: string;
}

/**
 * Move your own pieces onto every star. It is always your turn (the other side never moves),
 * so the position may have no kings and only the pieces being taught. Black pieces in the FEN are
 * obstacles that can be captured. Stars can be collected in any order.
 * Three stars for finishing in `par` moves or fewer.
 */
export interface CollectTask extends TaskBase {
  type: 'collect';
  stars: string[];
  par: number;
}

/**
 * Capture every black piece. Black never moves and it is always your turn, as in `collect`.
 * Three stars for finishing in `par` moves or fewer.
 */
export interface CaptureTask extends TaskBase {
  type: 'capture';
  par: number;
}

/**
 * Play the right move, possibly several in a row. The side to move in the FEN is the learner's side,
 * and the board faces them. After each accepted move the other side answers with `reply`, if given.
 * A wrong move is shown, counted as a mistake, and taken back.
 */
export interface MovesTask extends TaskBase {
  type: 'moves';
  steps: {
    /** Any of these moves is right. 'check' accepts any checking move, 'mate' any checkmate. */
    accept: string[] | 'check' | 'mate';
    /** The other side's answer, in UCI. Required on every step but the last. */
    reply?: string;
  }[];
}

/**
 * Checkmate a king that defends as well as it can (Stockfish plays the other side).
 * The learner moves first. It fails on stalemate, on losing all mating material, or after `limit` moves.
 * Three stars for mating in `par` moves or fewer.
 */
export interface MateTask extends TaskBase {
  type: 'mate';
  par: number;
  limit: number;
}

/** A question about the position, answered by picking one option. */
export interface ChooseTask extends TaskBase {
  type: 'choose';
  options: string[];
  /** Index into options. */
  answer: number;
  /** Arrows ('e2e4') and dots ('e4') drawn on the board for the question. */
  arrows?: string[];
  dots?: string[];
}

export type Task = CollectTask | CaptureTask | MovesTask | MateTask | ChooseTask;

export interface Lesson {
  /** Stable id used in the URL and saved progress: 'rook', 'en-passant'. */
  id: string;
  title: string;
  /** One line for the course map: "Moves in straight lines, as far as it likes." */
  blurb: string;
  /** Piece shown on the lesson's card. */
  icon: 'pawn' | 'knight' | 'bishop' | 'rook' | 'queen' | 'king';
  intro: Intro;
  /** Three to six tasks, easy to hard. */
  tasks: Task[];
}

export interface Unit {
  id: string;
  title: string;
  lessons: Lesson[];
}
