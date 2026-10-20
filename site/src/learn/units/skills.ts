import type { Lesson } from '../types';

const forks: Lesson = {
  id: 'forks',
  title: 'Forks',
  blurb: 'One piece, two targets.',
  icon: 'knight',
  intro: {
    text: [
      'A fork is one piece attacking two enemy pieces at the same time. Your opponent can usually save only one of them.',
      'Forks are strongest with a check, because the king must be saved first. Knights are famous for forks, but every piece can fork.',
    ],
    demo: {
      fen: 'r3k3/5ppp/8/1N6/8/8/5PPP/6K1 w - - 0 1',
      moves: ['b5c7', 'e8e7', 'c7a8'],
    },
  },
  tasks: [
    {
      type: 'moves',
      prompt: 'Attack the king and the queen together with your knight, then take the queen.',
      fen: '3q3k/ppp2ppp/8/6N1/8/8/PPP2PPP/6K1 w - - 0 1',
      steps: [{ accept: ['g5f7'], reply: 'h8g8' }, { accept: ['f7d8'] }],
      explain: 'The knight took a pawn with check and hit the queen. After the king moved, the queen was yours.',
    },
    {
      type: 'moves',
      prompt: 'Fork the king and the rook with your knight, then collect the rook.',
      fen: '2r3k1/pp3ppp/1b6/3N4/8/8/PP3PPP/3R2K1 w - - 0 1',
      steps: [{ accept: ['d5e7'], reply: 'g8f8' }, { accept: ['e7c8'] }],
    },
    {
      type: 'moves',
      prompt: 'Even a pawn can fork. Attack both knights, then take one.',
      fen: '6k1/pp3ppp/2n1n3/8/3P4/4P3/PP3PPP/5BK1 w - - 0 1',
      steps: [{ accept: ['d4d5'], reply: 'c6e5' }, { accept: ['d5e6'] }],
      explain: 'A pawn attacks both squares diagonally in front of it. Black could save only one knight.',
    },
    {
      type: 'moves',
      prompt: 'Check the king and attack the rook with one queen move. Then take the rook.',
      fen: 'r5k1/p1p3pp/8/8/8/8/PP3PPP/3Q2K1 w - - 0 1',
      steps: [{ accept: ['d1d5'], reply: 'g8f8' }, { accept: ['d5a8'] }],
    },
    {
      type: 'moves',
      prompt: 'You are Black. Fork the king and a rook with your knight, then take the rook.',
      fen: '3r2k1/pp3ppp/2p5/8/3n4/8/PP3PPP/R3K2R b - - 0 1',
      steps: [{ accept: ['d4c2'], reply: 'e1e2' }, { accept: ['c2a1'] }],
    },
  ],
};

const pins: Lesson = {
  id: 'pins',
  title: 'Pins',
  blurb: 'A piece that cannot move without losing more.',
  icon: 'bishop',
  intro: {
    text: [
      'A pin is an attack on a piece that has something more valuable behind it. If the piece moves away, the one behind is lost.',
      'When the piece behind is the king, the pinned piece may not move off the line at all.',
      'Rooks, bishops and queens make pins. A pinned piece is an easy target, so attack it again.',
    ],
    demo: {
      fen: '4k3/pp3ppp/2n5/1B6/8/8/5PPP/6K1 w - - 0 1',
      arrows: ['b5e8'],
    },
  },
  tasks: [
    {
      type: 'choose',
      prompt: 'You are Black. Can your knight move?',
      fen: '4k2r/pp3ppp/2n5/1B6/8/8/5PPP/6K1 b - - 0 1',
      options: ['Yes', 'No'],
      answer: 1,
      explain: 'No. The bishop pins it to your king. If the knight moved, your king would be in check.',
    },
    {
      type: 'moves',
      prompt: 'The black knight is pinned. Attack it with a pawn, then take it.',
      fen: '4k2r/pp3ppp/2n5/1B6/3P4/8/P4PPP/RN4K1 w - - 0 1',
      steps: [{ accept: ['d4d5'], reply: 'e8e7' }, { accept: ['d5c6'] }],
      explain: 'The knight could not run in time, so your pawn took it.',
    },
    {
      type: 'moves',
      prompt: 'Pin the black queen to her king with your bishop, then win her.',
      fen: '4k2r/pp1q1ppp/8/8/P7/8/5PPP/RN3BK1 w - - 0 1',
      steps: [{ accept: ['f1b5'], reply: 'd7b5' }, { accept: ['a4b5'] }],
      explain: 'The queen could only take the bishop, and your pawn took her back. A queen for a bishop.',
    },
    {
      type: 'moves',
      prompt: "Black's bishop is pinned to the king. Win it with a pawn.",
      fen: '4k2r/pp4pp/5p2/4b3/8/8/PP3PPP/1N2R1K1 w - - 0 1',
      steps: [{ accept: ['f2f4'], reply: 'e8f7' }, { accept: ['f4e5'] }],
    },
    {
      type: 'moves',
      prompt: 'You are Black. Pin the white queen to her king, then win her.',
      fen: '5bk1/p4ppp/1p6/8/3Q4/8/PP4PP/6K1 b - - 0 1',
      steps: [{ accept: ['f8c5'], reply: 'd4c5' }, { accept: ['b6c5'] }],
    },
  ],
};

const backRank: Lesson = {
  id: 'back-rank',
  title: 'Back-rank mate',
  blurb: 'A king trapped behind his own pawns.',
  icon: 'rook',
  intro: {
    text: [
      'A king on the back row, walled in by his own pawns, can be mated by a rook or queen on that row. This is a back-rank mate.',
      'It is one of the most common ways games end. To stay safe, give your king an escape square by moving a pawn in front of him.',
    ],
    demo: {
      fen: '6k1/5ppp/8/8/8/8/5PPP/4R1K1 w - - 0 1',
      moves: ['e1e8'],
    },
  },
  tasks: [
    {
      type: 'moves',
      prompt: "Black's king is stuck behind his pawns. Checkmate on the back row.",
      fen: '6k1/pp3ppp/1n6/8/8/8/PP3PPP/4R1K1 w - - 0 1',
      steps: [{ accept: 'mate' }],
    },
    {
      type: 'moves',
      prompt: "You are Black. White's rook has left the back row. Punish it.",
      fen: '3r2k1/Rp3ppp/8/8/8/8/5PPP/6K1 b - - 0 1',
      steps: [{ accept: 'mate' }],
    },
    {
      type: 'moves',
      prompt: "Mate in two. Black's rook guards the back row, so remove it first.",
      fen: '3r2k1/pp3ppp/8/8/8/8/P3RPPP/4R1K1 w - - 0 1',
      steps: [{ accept: ['e2e8'], reply: 'd8e8' }, { accept: 'mate' }],
      explain: "Your first rook pulled Black's rook away. The second one mated on the same square.",
    },
    {
      type: 'choose',
      prompt: 'Which move gives your king an escape square?',
      fen: '4r1k1/5ppp/8/8/8/8/PP3PPP/3R2K1 w - - 0 1',
      arrows: ['h2h3', 'a2a3', 'd1d2'],
      options: ['Push the h-pawn one square', 'Push the a-pawn one square', 'Move the rook up one square'],
      answer: 0,
      explain: 'With the h-pawn moved, the king can step off the back row if he is ever checked there.',
    },
  ],
};

const queenMate: Lesson = {
  id: 'queen-mate',
  title: 'Mate with the queen',
  blurb: 'King and queen against a lone king.',
  icon: 'queen',
  intro: {
    text: [
      "A king and queen can always mate a lone king. Use the queen to shrink his box, staying a knight's move away from him.",
      'Once he is stuck on the edge, bring your own king close. Then mate with the queen, protected by your king.',
      'Always leave him a move until the mate. Trapping him without check is stalemate.',
    ],
    demo: {
      fen: '8/7k/5Q2/3K4/8/8/8/8 w - - 0 1',
      moves: ['f6g5', 'h7h8', 'd5e6', 'h8h7', 'e6f6', 'h7h8', 'g5g7'],
    },
  },
  tasks: [
    {
      type: 'moves',
      prompt: 'Mate in one. Your king can protect the queen.',
      fen: 'k7/7Q/1K6/8/8/8/8/8 w - - 0 1',
      steps: [{ accept: 'mate' }],
    },
    {
      type: 'moves',
      prompt: 'Mate in two. The queen has boxed the king in. Bring your king closer.',
      fen: '7k/8/8/2Q2K2/8/8/8/8 w - - 0 1',
      steps: [{ accept: ['f5g6'], reply: 'h8g8' }, { accept: 'mate' }],
      hint: 'Queen moves here either let the king out or leave him with no move at all.',
    },
    {
      type: 'mate',
      prompt: 'Checkmate the black king. The computer will defend.',
      fen: '8/8/4k3/8/3K4/6Q1/8/8 w - - 0 1',
      par: 8,
      limit: 40,
      hint: "Keep the queen a knight's move from the king, and walk your own king over.",
    },
    {
      type: 'mate',
      prompt: 'Now from the middle of the board. Push him to an edge first.',
      fen: '8/8/8/4k3/8/2K5/8/3Q4 w - - 0 1',
      par: 11,
      limit: 40,
    },
  ],
};

const rookMate: Lesson = {
  id: 'rook-mate',
  title: 'Mate with the rook',
  blurb: 'King and rook against a lone king.',
  icon: 'rook',
  intro: {
    text: [
      'A king and rook can mate a lone king too, but it takes longer. Use the rook to cut the king off from the rest of the board.',
      'Walk your king up to face his, with one square between them. Then check along the edge.',
      'If his king attacks your rook, move the rook far away along the same line.',
    ],
    demo: {
      fen: '6k1/8/4K3/8/8/8/8/R7 w - - 0 1',
      moves: ['e6f6', 'g8h7', 'a1a8', 'h7h6', 'a8h8'],
    },
  },
  tasks: [
    {
      type: 'moves',
      prompt: 'The kings face each other. Mate with the rook.',
      fen: '5k2/8/5K2/8/8/8/8/R7 w - - 0 1',
      steps: [{ accept: 'mate' }],
    },
    {
      type: 'moves',
      prompt: 'Mate in two. Step your king up first.',
      fen: '7k/1R6/5K2/8/8/8/8/8 w - - 0 1',
      steps: [{ accept: ['f6g6'], reply: 'h8g8' }, { accept: 'mate' }],
    },
    {
      type: 'moves',
      prompt: 'Mate in two. This time the rook takes away a square first.',
      fen: '1k6/8/K7/8/8/8/8/6R1 w - - 0 1',
      steps: [{ accept: ['g1c1'], reply: 'b8a8' }, { accept: 'mate' }],
    },
    {
      type: 'mate',
      prompt: 'Checkmate the black king. The computer will defend.',
      fen: '8/6k1/8/4K3/8/8/8/R7 w - - 0 1',
      par: 10,
      limit: 50,
    },
    {
      type: 'mate',
      prompt: 'From the middle of the board. Cut the king off, then push him back.',
      fen: '8/8/4k3/8/8/3K4/8/7R w - - 0 1',
      par: 20,
      limit: 50,
      hint: 'Use the rook as a wall. Move your king toward his, and squeeze one row at a time.',
    },
  ],
};

const opening: Lesson = {
  id: 'opening',
  title: 'Opening principles',
  blurb: 'Take the centre, develop, castle.',
  icon: 'pawn',
  intro: {
    text: [
      'In the first moves of a game, put a pawn or two in the centre: the four squares in the middle of the board.',
      'Then bring out your knights and bishops. This is called developing. Castle early to keep your king safe.',
      "Don't bring the queen out early. Enemy pieces can chase her around and develop as they do it.",
    ],
    demo: {
      fen: 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1',
      moves: ['e2e4', 'e7e5', 'g1f3', 'b8c6', 'f1c4', 'f8c5', 'e1g1', 'g8f6'],
    },
  },
  tasks: [
    {
      type: 'choose',
      prompt: 'Which first move follows the opening rules?',
      fen: 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1',
      arrows: ['e2e4', 'a2a3', 'h2h4'],
      options: ['The pawn in front of the king, two squares', 'The far-left pawn, one square', 'The far-right pawn, two squares'],
      answer: 0,
      explain: 'It takes a centre square and opens lines for your queen and a bishop.',
    },
    {
      type: 'choose',
      prompt: 'Both sides have pushed a centre pawn. What should White do next?',
      fen: 'rnbqkbnr/pppp1ppp/8/4p3/4P3/8/PPPP1PPP/RNBQKBNR w KQkq - 0 2',
      options: ['Bring out knights and bishops, then castle', 'Bring the queen out to attack', 'Push the pawns beside the rooks'],
      answer: 0,
    },
    {
      type: 'moves',
      prompt: "Black's queen came out early. Develop a piece and attack her at once.",
      fen: 'rnb1kbnr/ppp1pppp/8/3q4/8/8/PPPP1PPP/RNBQKBNR w KQkq - 0 3',
      steps: [{ accept: ['b1c3'] }],
      explain: 'The queen has to move again, while you bring out another piece.',
    },
    {
      type: 'moves',
      prompt: "Black's queen came out early again. Develop a piece or castle.",
      fen: 'r1b1kbnr/pppp1ppp/2n2q2/4p3/2B1P3/5N2/PPPP1PPP/RNBQK2R w KQkq - 4 4',
      steps: [{ accept: ['b1c3', 'e1g1'] }],
      hint: 'Bring out your other knight, or castle. Both follow the rules and keep you ahead.',
    },
  ],
};

export const skills = [forks, pins, backRank, queenMate, rookMate, opening];
