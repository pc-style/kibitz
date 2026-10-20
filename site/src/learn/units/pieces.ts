import type { Lesson } from '../types';

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

const bishop: Lesson = {
  id: 'bishop',
  title: 'The bishop',
  blurb: 'Diagonals, as far as it likes.',
  icon: 'bishop',
  intro: {
    text: [
      'The bishop moves diagonally, as many squares as it likes. Like the rook, it stops at anything in its way.',
      'Moving diagonally keeps it on one colour. A bishop that starts on a dark square stays on dark squares all game.',
    ],
    demo: {
      fen: '8/8/8/8/3B4/8/8/8 w - - 0 1',
      dots: ['a1', 'b2', 'c3', 'e5', 'f6', 'g7', 'h8', 'a7', 'b6', 'c5', 'e3', 'f2', 'g1'],
      moves: ['d4a7', 'a7e3', 'e3h6', 'h6f8', 'f8a3'],
    },
  },
  tasks: [
    {
      type: 'collect',
      prompt: 'Take both stars with the bishop.',
      fen: '8/8/8/8/8/8/8/2B5 w - - 0 1',
      stars: ['a3', 'f8'],
      par: 2,
    },
    {
      type: 'collect',
      prompt: 'Three stars. Find the shortest way.',
      fen: '8/8/8/8/8/8/8/5B2 w - - 0 1',
      stars: ['b5', 'e8', 'h5'],
      par: 3,
    },
    {
      type: 'collect',
      prompt: "The star is on the bishop's colour, but not on its diagonals. Find a way.",
      fen: '8/8/8/8/8/8/8/2B5 w - - 0 1',
      stars: ['c5'],
      par: 2,
      explain: 'Any dark square is two moves away at most. Light squares are out of reach for this bishop.',
    },
    {
      type: 'capture',
      prompt: 'Capture all four pawns.',
      fen: '8/8/3p4/4p3/8/2p3p1/8/B7 w - - 0 1',
      par: 4,
    },
  ],
};

const queen: Lesson = {
  id: 'queen',
  title: 'The queen',
  blurb: 'Rook and bishop in one.',
  icon: 'queen',
  intro: {
    text: [
      'The queen moves like a rook and a bishop put together: straight or diagonally, as far as she likes.',
      'That makes her the strongest piece on the board.',
    ],
    demo: {
      fen: '8/8/8/8/3Q4/8/8/8 w - - 0 1',
      dots: [
        'd1', 'd2', 'd3', 'd5', 'd6', 'd7', 'd8', 'a4', 'b4', 'c4', 'e4', 'f4', 'g4', 'h4',
        'a1', 'b2', 'c3', 'e5', 'f6', 'g7', 'h8', 'a7', 'b6', 'c5', 'e3', 'f2', 'g1',
      ],
      moves: ['d4d8', 'd8h4', 'h4e1', 'e1a5', 'a5a1', 'a1d4'],
    },
  },
  tasks: [
    {
      type: 'collect',
      prompt: 'Take the stars in the other three corners.',
      fen: '8/8/8/8/8/8/8/Q7 w - - 0 1',
      stars: ['h8', 'h1', 'a8'],
      par: 3,
    },
    {
      type: 'collect',
      prompt: 'Your pawns block the way out. Find a gap.',
      fen: '8/8/8/8/8/8/2PPPP2/3Q4 w - - 0 1',
      stars: ['a4', 'e8'],
      par: 3,
    },
    {
      type: 'capture',
      prompt: 'Capture all the black pieces.',
      fen: '8/1p4p1/8/3r4/8/1n4b1/8/3Q4 w - - 0 1',
      par: 5,
    },
    {
      type: 'capture',
      prompt: 'Six pieces, six moves. Plan your route before you start.',
      fen: '5n2/8/5r2/p3n3/8/8/1b5p/Q7 w - - 0 1',
      par: 6,
    },
  ],
};

const king: Lesson = {
  id: 'king',
  title: 'The king',
  blurb: 'One step in any direction.',
  icon: 'king',
  intro: {
    text: [
      'The king moves one square in any direction.',
      "He is the most important piece. If he is trapped, you lose the game. You'll see how in a later lesson.",
      'So the king may never step onto a square where an enemy piece could capture him.',
    ],
    demo: {
      fen: '8/8/8/8/4K3/8/8/8 w - - 0 1',
      dots: ['d3', 'd4', 'd5', 'e3', 'e5', 'f3', 'f4', 'f5'],
      moves: ['e4e5', 'e5f6', 'f6f5', 'f5e4'],
    },
  },
  tasks: [
    {
      type: 'collect',
      prompt: 'Walk the king to the star, one square at a time.',
      fen: '8/8/8/8/8/8/8/4K3 w - - 0 1',
      stars: ['e4'],
      par: 3,
    },
    {
      type: 'collect',
      prompt: 'Take both stars. Diagonal steps are just as quick as straight ones.',
      fen: '8/8/8/8/8/8/1K6/8 w - - 0 1',
      stars: ['d4', 'f4'],
      par: 4,
    },
    {
      type: 'capture',
      prompt: "Capture the rook. The king can't step onto a square the rook attacks.",
      fen: '8/8/8/8/8/4r3/8/4K3 w - - 0 1',
      par: 2,
      hint: 'The rook attacks every square on its row and column. Come at it from the side.',
      explain: 'The king can take a piece next to him, as long as no other enemy piece guards it.',
    },
    {
      type: 'capture',
      prompt: 'Capture both rooks. Which one can you reach first?',
      fen: '8/8/2r5/8/8/5r2/8/4K3 w - - 0 1',
      par: 5,
      hint: 'The rook on the third row walls off the whole row. Take that one first.',
    },
  ],
};

const knight: Lesson = {
  id: 'knight',
  title: 'The knight',
  blurb: 'An L-shaped jump over anything.',
  icon: 'knight',
  intro: {
    text: [
      'The knight moves in an L: two squares in a straight line, then one square to the side.',
      "It is the only piece that jumps. Pieces in between don't stop it.",
      'Each jump takes it to a square of the other colour.',
    ],
    demo: {
      fen: '8/8/8/2PPP3/2PNP3/2PPP3/8/8 w - - 0 1',
      dots: ['b3', 'b5', 'c2', 'c6', 'e2', 'e6', 'f3', 'f5'],
      moves: ['d4e6', 'e6g5', 'g5f3', 'f3d4'],
    },
  },
  tasks: [
    {
      type: 'collect',
      prompt: 'Take both stars with the knight.',
      fen: '8/8/8/8/8/8/8/1N6 w - - 0 1',
      stars: ['c3', 'e4'],
      par: 2,
    },
    {
      type: 'collect',
      prompt: 'Jump over your own pawns to reach the stars.',
      fen: '8/8/8/8/8/8/5PPP/6N1 w - - 0 1',
      stars: ['f3', 'g5'],
      par: 2,
    },
    {
      type: 'collect',
      prompt: "The star is right next to the knight. That's the hard part.",
      fen: '8/8/8/8/3N4/8/8/8 w - - 0 1',
      stars: ['d5'],
      par: 3,
      explain: 'A knight needs three jumps to reach a square straight beside it.',
    },
    {
      type: 'capture',
      prompt: 'Capture all four pawns, one jump each.',
      fen: '8/8/1p6/4p3/2p5/5p2/8/6N1 w - - 0 1',
      par: 4,
    },
  ],
};

const pawn: Lesson = {
  id: 'pawn',
  title: 'The pawn',
  blurb: 'One step forward, captures on the diagonal.',
  icon: 'pawn',
  intro: {
    text: [
      'The pawn moves straight forward, one square at a time. It never moves backwards.',
      'From its starting square, a pawn may move two squares instead of one.',
      'It captures differently: one square diagonally forward. A piece right in front of it blocks it.',
    ],
    demo: {
      fen: '8/8/8/3p4/8/8/4P3/8 w - - 0 1',
      dots: ['e3', 'e4'],
      moves: ['e2e4', 'e4d5', 'd5d6', 'd6d7'],
    },
  },
  tasks: [
    {
      type: 'collect',
      prompt: 'Take both stars. Use the two-square move from the start.',
      fen: '8/8/8/8/8/8/4P3/8 w - - 0 1',
      stars: ['e4', 'e6'],
      par: 3,
    },
    {
      type: 'collect',
      prompt: 'Only a pawn on its starting square may move two squares.',
      fen: '8/8/8/8/8/5P2/2P5/8 w - - 0 1',
      stars: ['c4', 'f5'],
      par: 3,
    },
    {
      type: 'capture',
      prompt: 'Both pawns are blocked. Capture both black pieces anyway.',
      fen: '8/8/8/8/8/3nb3/3PP3/8 w - - 0 1',
      par: 2,
      hint: "A pawn can't capture straight ahead. Try the diagonal.",
    },
    {
      type: 'capture',
      prompt: 'Capture all four pieces with one pawn.',
      fen: '8/8/4q3/3r4/2b5/1n6/2P5/8 w - - 0 1',
      par: 4,
    },
    {
      type: 'choose',
      prompt: 'Can the white pawn move?',
      fen: '4k3/8/8/4p3/4P3/8/8/4K3 w - - 0 1',
      options: ['Yes', 'No'],
      answer: 1,
      explain: "No. The black pawn blocks it, and there is nothing on its diagonals to capture.",
    },
  ],
};

export const pieces = [rook, bishop, queen, king, knight, pawn];
