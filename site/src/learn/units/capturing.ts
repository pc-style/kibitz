import type { Lesson } from '../types';

const capture: Lesson = {
  id: 'capture',
  title: 'Capturing',
  blurb: 'Move onto an enemy piece to take it.',
  icon: 'knight',
  intro: {
    text: [
      'To capture, move your piece onto a square with an enemy piece on it. The enemy piece leaves the board.',
      'Every piece captures the same way it moves. The pawn is the one exception: it moves straight but captures diagonally.',
    ],
    demo: {
      fen: '8/8/p7/1p6/8/7p/8/R4BN1 w - - 0 1',
      moves: ['a1a6', 'f1b5', 'g1h3'],
    },
  },
  tasks: [
    {
      type: 'capture',
      prompt: 'Capture all three pawns with the rook and the bishop.',
      fen: '8/8/1p5p/8/5p2/8/8/1RB5 w - - 0 1',
      par: 3,
    },
    {
      type: 'capture',
      prompt: 'Capture everything with the knight and the queen.',
      fen: '8/3r4/6b1/4n3/p7/5N2/8/3Q4 w - - 0 1',
      par: 4,
    },
    {
      type: 'capture',
      prompt: 'A pawn, a knight and a bishop. Work out who takes what.',
      fen: '7r/8/8/3p1p2/1n2P3/2N5/1B6/q7 w - - 0 1',
      par: 5,
      hint: 'Your own knight blocks the bishop. Move it first.',
    },
    {
      type: 'moves',
      prompt: 'Now a position from a real game. Capture the black queen.',
      fen: '1n4k1/pp3ppp/8/8/3q4/5N2/PP3PPP/6K1 w - - 0 1',
      steps: [{ accept: ['f3d4'] }],
      explain: 'Nothing protected the queen, so your knight took her for free.',
    },
    {
      type: 'moves',
      prompt: 'You play Black now. Capture the white rook.',
      fen: '6k1/p4ppp/5n2/8/4R3/8/P5PP/7K b - - 0 1',
      steps: [{ accept: ['f6e4'] }],
    },
  ],
};

const pieceValues: Lesson = {
  id: 'piece-values',
  title: 'What pieces are worth',
  blurb: 'Pawn 1, knight 3, bishop 3, rook 5, queen 9.',
  icon: 'queen',
  intro: {
    text: [
      'Some pieces are worth more than others. Count a pawn as 1, a knight or a bishop as 3, a rook as 5 and the queen as 9.',
      "The king has no number. He can't be captured or traded.",
      'Use the numbers to choose captures. Giving a knight (3) for a rook (5) is a good trade. Giving a rook for a knight is not.',
    ],
    demo: {
      fen: '6k1/1p3ppp/2r5/8/3N4/8/5PPP/6K1 w - - 0 1',
      moves: ['d4c6', 'b7c6'],
    },
  },
  tasks: [
    {
      type: 'choose',
      prompt: 'Add up the pieces, leaving out the kings. Who has more?',
      fen: '6k1/5ppp/2b2n2/8/8/8/5PPP/3R2K1 w - - 0 1',
      options: ['White', 'Black', 'Neither'],
      answer: 1,
      explain: 'White has a rook (5). Black has a bishop and a knight (3 + 3 = 6). The pawns cancel out.',
    },
    {
      type: 'moves',
      prompt: 'Your queen can capture two pieces. Take the one worth more.',
      fen: '6k1/3r1ppp/8/8/n7/8/5PPP/3Q2K1 w - - 0 1',
      steps: [{ accept: ['d1d7'] }],
      hint: 'A rook is worth 5, a knight 3.',
    },
    {
      type: 'moves',
      prompt: "Make a good trade: give your bishop (3) for Black's rook (5).",
      fen: '6k1/p4ppp/5r2/8/8/8/PB3PPP/6K1 w - - 0 1',
      steps: [{ accept: ['b2f6'] }],
      explain: 'A pawn takes your bishop back, but you gave 3 and won 5.',
    },
    {
      type: 'moves',
      prompt: 'You are Black. Three captures are possible. Pick the one that wins most.',
      fen: '5bk1/p4ppp/1n1R4/3p4/P3B3/5P2/1P4PP/6K1 b - - 0 1',
      steps: [{ accept: ['f8d6'] }],
      explain: 'The rook is worth 5 and nothing protects it. Taking the bishop would cost your pawn.',
    },
  ],
};

const protect: Lesson = {
  id: 'protect',
  title: 'Protecting pieces',
  blurb: 'Take what is free. Keep your own pieces safe.',
  icon: 'rook',
  intro: {
    text: [
      'A piece is protected, or defended, when another piece of its own side could capture back on its square.',
      'Taking a protected piece usually costs you the piece you took it with. Taking an unprotected piece wins it for free.',
      'When one of your pieces is attacked, move it somewhere safe or protect it.',
    ],
    demo: {
      fen: '6k1/5ppp/4p3/3n4/8/8/5PPP/3R2K1 w - - 0 1',
      arrows: ['e6d5'],
      moves: ['d1d5', 'e6d5'],
    },
  },
  tasks: [
    {
      type: 'choose',
      prompt: 'Your rook attacks a knight and a bishop. Which one is unprotected?',
      fen: '6k1/5ppp/4n3/8/1b2R3/8/5PPP/6K1 w - - 0 1',
      options: ['The knight', 'The bishop'],
      answer: 1,
      explain: "The pawn next to the knight could capture back. Nothing guards the bishop.",
    },
    {
      type: 'moves',
      prompt: 'Take the piece that nothing protects.',
      fen: '6k1/p4ppp/n3n3/8/2B5/8/P4PPP/6K1 w - - 0 1',
      steps: [{ accept: ['c4a6'] }],
      hint: 'A pawn guards one of the knights. Look for the other.',
    },
    {
      type: 'choose',
      prompt: 'Your queen can take the knight. Is that a good idea?',
      fen: '3q2k1/5ppp/4p3/3n4/8/8/5PPP/3Q2K1 w - - 0 1',
      options: ['Yes, it wins a knight', 'No, she would be taken'],
      answer: 1,
      explain: 'The knight is protected. You would give your queen (9) to win a knight (3).',
    },
    {
      type: 'moves',
      prompt: 'A pawn attacks your knight. Move the knight to a safe square.',
      fen: '6k1/p1p2ppp/3p4/1p6/N7/8/1P3PPP/6K1 w - - 0 1',
      steps: [{ accept: ['a4c3'] }],
      hint: 'Check which squares the black pawns attack before you land.',
      explain: "Protecting the knight wouldn't help. A pawn is worth less, so Black would gladly trade it for your knight.",
    },
  ],
};

export const capturing = [capture, pieceValues, protect];
