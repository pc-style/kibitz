import type { Lesson } from '../types';

const check: Lesson = {
  id: 'check',
  title: 'Check',
  blurb: 'An attack on the king.',
  icon: 'king',
  intro: {
    text: [
      'When a piece attacks the king, that king is in check.',
      'A king in check must get out of it on the very next move. You may never make a move that leaves your own king in check.',
    ],
    demo: {
      fen: '8/8/8/4k3/8/8/5PPP/R5K1 w - - 0 1',
      moves: ['a1a5', 'e5d4', 'a5a4', 'd4c3'],
    },
  },
  tasks: [
    {
      type: 'choose',
      prompt: 'Your king is in check. Which piece is giving check?',
      fen: 'r5k1/1b3ppp/8/8/8/3n4/3P1PPP/R3K3 w - - 0 1',
      options: ['The rook', 'The bishop', 'The knight'],
      answer: 2,
      explain: 'The knight attacks your king with its L-shaped jump.',
    },
    {
      type: 'choose',
      prompt: 'Can your king move to the dotted square?',
      fen: '3r2k1/5ppp/8/8/8/8/5PPP/R3K3 w - - 0 1',
      dots: ['d2'],
      options: ['Yes', 'No'],
      answer: 1,
      explain: 'No. The black rook attacks that square. A king can never move into check.',
    },
    {
      type: 'moves',
      prompt: 'Check with your rook, then take what the check wins.',
      fen: '8/4k2q/4p1p1/1p6/8/8/5PPP/R5K1 w - - 0 1',
      steps: [{ accept: 'check', reply: 'e7d6' }, { accept: ['a7h7'] }],
      explain: 'The king had to move out of check, so the queen behind him was left for your rook.',
    },
    {
      type: 'moves',
      prompt: 'Give check with your knight, then see what else it attacks.',
      fen: '2q1k3/pp3ppp/8/8/2N5/8/PP3PPP/6K1 w - - 0 1',
      steps: [{ accept: 'check', reply: 'e8d7' }, { accept: ['d6c8'] }],
      explain: 'Your knight checked the king and attacked the queen at once. Black could only save the king.',
    },
  ],
};

const outOfCheck: Lesson = {
  id: 'out-of-check',
  title: 'Getting out of check',
  blurb: 'Move, block or capture.',
  icon: 'king',
  intro: {
    text: [
      'There are three ways out of check: move the king to a safe square, block the check by putting a piece in the way, or capture the piece giving check.',
      "A knight's check can't be blocked, because the knight jumps.",
    ],
    demo: {
      fen: '4r1k1/5ppp/8/8/8/3B4/5PPP/6K1 b - - 0 1',
      moves: ['e8e1', 'd3f1'],
    },
  },
  tasks: [
    {
      type: 'moves',
      prompt: 'You are in check. Step out of it with your king.',
      fen: '1r4k1/5ppp/8/8/8/7P/3Q1PP1/r5K1 w - - 0 1',
      steps: [{ accept: ['g1h2'] }],
      hint: "Blocking with the queen loses her: the rook just takes her. Your king has a safe square.",
    },
    {
      type: 'moves',
      prompt: 'Your king has nowhere to go. Block the check.',
      fen: '6k1/p4ppp/8/8/2B5/8/5PPP/4r1K1 w - - 0 1',
      steps: [{ accept: ['c4f1'] }],
      explain: 'If the rook takes your bishop, your king takes the rook.',
    },
    {
      type: 'moves',
      prompt: "A knight's check can't be blocked. Capture the knight.",
      fen: '6k1/pp3ppp/8/8/8/5n2/PP1B1PPP/6K1 w - - 0 1',
      steps: [{ accept: ['g2f3'] }],
    },
    {
      type: 'moves',
      prompt: 'Get out of check without losing anything. Look at the whole board.',
      fen: '3q2k1/pp3ppp/8/8/8/5n2/PP3PPP/3Q2K1 w - - 0 1',
      steps: [{ accept: ['d1f3'] }],
      hint: 'If the pawn takes, the black queen takes yours. Use the queen to capture.',
      explain: 'Capturing with the queen ends the check and moves her away from the black queen.',
    },
  ],
};

const checkmate: Lesson = {
  id: 'checkmate',
  title: 'Checkmate',
  blurb: 'Check with no way out. The game is over.',
  icon: 'queen',
  intro: {
    text: [
      "When a king is in check and there is no way out, it's checkmate, or mate for short. The game is over, and whoever gave mate wins.",
      "Checkmate is the goal of the game. The king is never actually captured: mate ends the game first.",
    ],
    demo: {
      fen: '7k/8/6K1/8/8/8/8/1Q6 w - - 0 1',
      moves: ['b1b8'],
    },
  },
  tasks: [
    {
      type: 'choose',
      prompt: "It's your turn. Is your king in check or checkmate?",
      fen: '6k1/5ppp/8/8/8/8/P1B3PP/4r2K w - - 0 1',
      options: ['Check', 'Checkmate'],
      answer: 1,
      explain: "The rook can't be blocked or captured, and your own pawns box the king in.",
    },
    {
      type: 'choose',
      prompt: 'One pawn has moved. Is it still checkmate?',
      fen: '6k1/5ppp/8/8/8/7P/P1B3P1/4r2K w - - 0 1',
      options: ['Check', 'Checkmate'],
      answer: 0,
      explain: "Only check. The king can step to the square the pawn left.",
    },
    {
      type: 'moves',
      prompt: 'Checkmate in one move.',
      fen: '7k/8/6K1/8/8/8/8/3Q4 w - - 0 1',
      steps: [{ accept: 'mate' }],
      hint: 'Your king guards two of the escape squares. Check along the back row to cover the last one.',
    },
    {
      type: 'moves',
      prompt: 'Checkmate with a rook. The other rook guards the escape row.',
      fen: '6k1/R7/8/8/8/8/2K5/1R6 w - - 0 1',
      steps: [{ accept: 'mate' }],
    },
    {
      type: 'moves',
      prompt: 'You are Black. White has weakened the king. Checkmate in one.',
      fen: 'rnbqkbnr/pppp1ppp/8/4p3/6P1/5P2/PPPPP2P/RNBQKBNR b KQkq - 0 2',
      steps: [{ accept: 'mate' }],
      explain: "This is the fastest possible checkmate. White's king can't escape, and nothing can block.",
    },
    {
      type: 'moves',
      prompt: "Black's own pieces fence the king in. Mate with the knight.",
      fen: '3q2rk/pp4pp/8/6N1/8/8/5PPP/3Q2K1 w - - 0 1',
      steps: [{ accept: 'mate' }],
      explain: 'A knight mate against a king trapped by its own pieces is called a smothered mate.',
    },
  ],
};

const stalemate: Lesson = {
  id: 'stalemate',
  title: 'Stalemate',
  blurb: 'No legal move, but no check. A draw.',
  icon: 'pawn',
  intro: {
    text: [
      "If the player to move is not in check but has no legal move, it's stalemate. The game ends in a draw.",
      'Stalemate can rescue a player who is losing. When you are winning, make sure the enemy king always has a move.',
    ],
    demo: {
      fen: '7k/5K2/8/8/8/3Q4/8/8 w - - 0 1',
      moves: ['d3g6'],
    },
  },
  tasks: [
    {
      type: 'choose',
      prompt: "It's Black's turn. Is this checkmate or stalemate?",
      fen: '7k/5K2/6Q1/8/8/8/8/8 b - - 0 1',
      options: ['Checkmate', 'Stalemate'],
      answer: 1,
      explain: "The black king isn't in check, but every square around him is attacked. Black can't move, so it's a draw.",
    },
    {
      type: 'choose',
      prompt: 'The queen has moved. Checkmate or stalemate now?',
      fen: '7k/5K2/8/8/8/8/8/7Q b - - 0 1',
      options: ['Checkmate', 'Stalemate'],
      answer: 0,
      explain: "Now the king is in check and can't escape. That's checkmate.",
    },
    {
      type: 'moves',
      prompt: 'Find the checkmate. Most queen moves here are stalemate.',
      fen: '7k/5K2/8/8/8/8/8/1Q6 w - - 0 1',
      steps: [{ accept: 'mate' }],
      hint: "That was stalemate: Black couldn't move and wasn't in check. Give a check he can't escape.",
    },
    {
      type: 'moves',
      prompt: 'Checkmate with the rook. One rook move would be stalemate.',
      fen: '7k/8/6K1/8/8/8/8/R7 w - - 0 1',
      steps: [{ accept: 'mate' }],
      hint: 'Trapping the king without check is stalemate. Check him along the back row.',
    },
  ],
};

export const checkUnit = [check, outOfCheck, checkmate, stalemate];
