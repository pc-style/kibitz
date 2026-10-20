import type { Lesson, Unit } from './types';

const rook: Lesson = {
  id: 'rook',
  title: 'The rook',
  blurb: 'Straight lines, as far as it likes.',
  icon: 'rook',
  intro: {
    text: [
      'The rook moves in straight lines: up, down, left or right, as many squares as it likes.',
      "It can't jump. Anything in its way stops it.",
    ],
    demo: {
      fen: '8/8/8/8/3R4/8/8/8 w - - 0 1',
      dots: ['d1', 'd2', 'd3', 'd5', 'd6', 'd7', 'd8', 'a4', 'b4', 'c4', 'e4', 'f4', 'g4', 'h4'],
      moves: ['d4d7', 'd7a7', 'a7a2', 'a2h2', 'h2h4', 'h4d4'],
    },
  },
  tasks: [
    {
      type: 'collect',
      prompt: 'Take every star with the rook.',
      fen: '8/8/8/8/8/8/8/R7 w - - 0 1',
      stars: ['a5', 'e5'],
      par: 2,
    },
    {
      type: 'collect',
      prompt: 'Three stars this time. Take them in as few moves as you can.',
      fen: '8/8/8/8/8/8/1R6/8 w - - 0 1',
      stars: ['b7', 'g7', 'g2'],
      par: 3,
    },
    {
      type: 'collect',
      prompt: 'Your own pawns are in the way. Go around them.',
      fen: '8/8/8/8/PP6/8/8/R7 w - - 0 1',
      stars: ['a8'],
      par: 3,
      explain: 'Rooks never jump, so the quickest way is around the wall.',
    },
    {
      type: 'capture',
      prompt: 'Capture all the black pawns. A capture is a move onto the enemy piece.',
      fen: '8/8/p4p2/8/8/8/5p2/R7 w - - 0 1',
      par: 3,
    },
  ],
};

/** The whole course in order. The last stop, a game against the practice bot, lives outside this list. */
export const COURSE: Unit[] = [
  { id: 'pieces', title: 'How the pieces move', lessons: [rook] },
  { id: 'capturing', title: 'Capturing', lessons: [] },
  { id: 'check', title: 'Check and checkmate', lessons: [] },
  { id: 'special', title: 'Special moves', lessons: [] },
  { id: 'game', title: 'Playing a game', lessons: [] },
  { id: 'skills', title: 'First skills', lessons: [] },
];

export const LESSONS: Lesson[] = COURSE.flatMap((u) => u.lessons);
