import type { Lesson } from '../types';

const START = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';

const setup: Lesson = {
  id: 'setup',
  title: 'Setting up the board',
  blurb: 'Where every piece starts, and who goes first.',
  icon: 'pawn',
  intro: {
    text: [
      'Turn the board so that each player has a light square in the bottom-right corner.',
      'Rooks go in the corners, knights beside them, then bishops. The queen takes the middle square of her own colour, the king the one beside her. Pawns fill the row in front.',
      'White always moves first. Then the players take turns, one move each.',
    ],
    demo: {
      fen: START,
      moves: ['e2e4', 'e7e5', 'g1f3', 'b8c6'],
    },
  },
  tasks: [
    {
      type: 'choose',
      prompt: 'Look at the two dotted corners. Which one is a light square?',
      fen: START,
      dots: ['a1', 'h1'],
      options: ['The left one', 'The right one'],
      answer: 1,
      explain: 'Light square on the right. If yours is dark, turn the board a quarter turn.',
    },
    {
      type: 'choose',
      prompt: 'Which piece belongs on the dotted squares?',
      fen: '1nbqkbn1/pppppppp/8/8/8/8/PPPPPPPP/1NBQKBN1 w - - 0 1',
      dots: ['a1', 'h1', 'a8', 'h8'],
      options: ['A rook', 'A knight', 'A bishop'],
      answer: 0,
    },
    {
      type: 'choose',
      prompt: "Something is wrong with White's pieces. What is it?",
      fen: 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBKQBNR w kq - 0 1',
      options: ['The king and queen are swapped', 'The knights and bishops are swapped', 'Nothing, it is right'],
      answer: 0,
      explain: 'The white queen starts on a light square and the black queen on a dark one: each queen on her own colour.',
    },
    {
      type: 'choose',
      prompt: 'Who makes the first move?',
      fen: START,
      options: ['White', 'Black'],
      answer: 0,
    },
    {
      type: 'moves',
      prompt: 'You are White. Make the first move of the game. Any move will do.',
      fen: START,
      steps: [
        {
          accept: [
            'a2a3', 'a2a4', 'b2b3', 'b2b4', 'c2c3', 'c2c4', 'd2d3', 'd2d4', 'e2e3', 'e2e4',
            'f2f3', 'f2f4', 'g2g3', 'g2g4', 'h2h3', 'h2h4', 'b1a3', 'b1c3', 'g1f3', 'g1h3',
          ],
        },
      ],
      explain: 'At the start, only pawns and knights can move. Everything else is boxed in.',
    },
  ],
};

const gameEnd: Lesson = {
  id: 'game-end',
  title: 'How a game ends',
  blurb: 'Win, lose or draw, and all the ways to get there.',
  icon: 'king',
  intro: {
    text: [
      'You win by checkmate. A game also ends when a player resigns, which means giving up, or runs out of time on the clock.',
      'A game is a draw after stalemate, or when the same position comes up three times. It is also a draw when neither side has enough pieces left to checkmate.',
      'Last, it is a draw if both sides make 50 moves with no capture and no pawn move. Players may also simply agree to a draw.',
    ],
    demo: {
      fen: 'r4rk1/ppp5/7Q/4p3/8/q7/P5PP/7K w - - 0 1',
      moves: ['h6g6', 'g8h8', 'g6h6', 'h8g8', 'h6g6', 'g8h8'],
    },
  },
  tasks: [
    {
      type: 'choose',
      prompt: 'White has a king and a bishop. Black has only a king. What happens?',
      fen: '8/8/4k3/8/8/2KB4/8/8 w - - 0 1',
      options: ['White can still win', "It's a draw"],
      answer: 1,
      explain: "A king and one bishop can't checkmate, so the game ends in a draw. The same goes for a king and one knight.",
    },
    {
      type: 'choose',
      prompt: 'Both sides have made 50 moves with no capture and no pawn move. What now?',
      fen: '8/8/4k3/3r4/8/2K5/5R2/8 w - - 100 80',
      options: ['The game goes on', "It's a draw"],
      answer: 1,
    },
    {
      type: 'moves',
      prompt: 'You are far behind. Keep giving check until the position repeats three times.',
      fen: 'r4rk1/ppp5/7Q/4p3/8/q7/P5PP/7K w - - 0 1',
      steps: [
        { accept: ['h6g6'], reply: 'g8h8' },
        { accept: ['g6h6'], reply: 'h8g8' },
        { accept: ['h6g6'], reply: 'g8h8' },
        { accept: ['g6h6'], reply: 'h8g8' },
        { accept: ['h6g6'] },
      ],
      hint: 'Only checks keep you safe. Use the two checks next to the black king, back and forth.',
      explain: 'The same position came up three times, so the game is a draw. You saved a lost game.',
    },
    {
      type: 'choose',
      prompt: 'Your opponent is far behind and decides to give up. What is that called?',
      fen: '6k1/5ppp/8/8/8/8/5PPP/3QR1K1 w - - 0 1',
      options: ['Resigning', 'Running out of time', 'A draw'],
      answer: 0,
      explain: 'Resigning ends the game at once, and you win.',
    },
    {
      type: 'choose',
      prompt: "Your opponent's clock runs out before yours. Who wins?",
      fen: 'r1bqk2r/pppp1ppp/2n2n2/2b1p3/2B1P3/3P1N2/PPP2PPP/RNBQK2R w KQkq - 1 5',
      options: ['You do', 'Your opponent does', 'Nobody, it is a draw'],
      answer: 0,
      explain: 'Running out of time loses, as long as the other player has enough pieces left to checkmate.',
    },
  ],
};

export const game = [setup, gameEnd];
