import type { Lesson } from '../types';

const castling: Lesson = {
  id: 'castling',
  title: 'Castling',
  blurb: 'King and rook move together, once a game.',
  icon: 'rook',
  intro: {
    text: [
      "Castling moves two pieces at once. The king steps two squares toward a rook, and that rook jumps to the king's other side.",
      'You may castle only if neither piece has moved yet and every square between them is empty.',
      "You can't castle out of check, through a square an enemy piece attacks, or into check.",
    ],
    demo: {
      fen: 'r3k2r/pppqbppp/2npbn2/4p3/4P3/3P1N2/PPP1BPPP/RNBQK2R w KQkq - 0 1',
      moves: ['e1g1', 'e8c8'],
    },
  },
  tasks: [
    {
      type: 'moves',
      prompt: 'Castle on the short side: move your king two squares toward the rook.',
      fen: 'r1bqk2r/pppp1ppp/2n2n2/2b1p3/2B1P3/3P1N2/PPP2PPP/RNBQK2R w KQkq - 1 5',
      steps: [{ accept: ['e1g1'] }],
      explain: 'Your king is tucked away behind pawns, and your rook is ready to join the game.',
    },
    {
      type: 'moves',
      prompt: 'Now castle on the long side, toward the other rook.',
      fen: 'rnbqk2r/ppp1bppp/4pn2/3p4/3P1B2/2N5/PPPQPPPP/R3KBNR w KQkq - 2 5',
      steps: [{ accept: ['e1c1'] }],
      explain: 'On the long side the king still moves two squares. The rook travels three.',
    },
    {
      type: 'choose',
      prompt: 'Can White castle on the short side here?',
      fen: 'r2qk1nr/pppp1ppp/b7/8/8/2N5/PPPP1PPP/R1BQK2R w KQkq - 0 1',
      options: ['Yes', 'No'],
      answer: 1,
      explain: 'No. The bishop attacks the square your king would pass over.',
    },
    {
      type: 'choose',
      prompt: 'Earlier, your king moved and then went back. Can you castle now?',
      fen: 'r1b1k2r/pppqbppp/2np1n2/4p3/4P3/2NPBN2/PPPQBPPP/R3K2R w kq - 0 1',
      options: ['Yes', 'No'],
      answer: 1,
      explain: 'No. Once the king has moved, castling is gone for the rest of the game, even if he goes back.',
    },
    {
      type: 'moves',
      prompt: 'Castle. Only one side is allowed right now.',
      fen: 'r2q2rk/pppn1p1p/3bp3/3p4/3P4/2NBPN2/PPPBQP1P/R3K2R w KQ - 0 1',
      steps: [{ accept: ['e1c1'] }],
      hint: 'On the short side your king would land on a square the rook attacks.',
    },
  ],
};

const enPassant: Lesson = {
  id: 'en-passant',
  title: 'En passant',
  blurb: 'A pawn capture that only lasts one move.',
  icon: 'pawn',
  intro: {
    text: [
      "When a pawn moves two squares and lands right beside an enemy pawn, that enemy pawn may capture it as if it had moved only one.",
      "This is called en passant, French for 'in passing'. It is allowed only on the very next move.",
    ],
    demo: {
      fen: '6k1/3p4/8/4P3/8/8/8/6K1 b - - 0 1',
      moves: ['d7d5', 'e5d6'],
    },
  },
  tasks: [
    {
      type: 'moves',
      prompt: 'Push your pawn one square. When the black pawn jumps beside it, take it en passant.',
      fen: '8/3p3k/8/8/4PK2/8/8/8 w - - 0 1',
      steps: [{ accept: ['e4e5'], reply: 'd7d5' }, { accept: ['e5d6'] }],
      explain: 'Your pawn landed on the square the black pawn jumped over, and the black pawn left the board.',
    },
    {
      type: 'moves',
      prompt: 'The black pawn just moved two squares. Capture it en passant.',
      fen: '8/8/8/3pP2k/8/8/8/K7 w - d6 0 1',
      steps: [{ accept: ['e5d6'] }],
      explain: 'Now your pawn has a clear road to the end of the board, and the black king is too far away.',
    },
    {
      type: 'moves',
      prompt: 'You are Black. The white pawn just jumped past yours. Take it en passant.',
      fen: '6k1/pp3ppp/8/8/2Pp4/8/PP3PPP/6K1 b - c3 0 1',
      steps: [{ accept: ['d4c3'] }],
    },
    {
      type: 'choose',
      prompt: 'The black pawn jumped two squares a few moves ago. Can you take it en passant?',
      fen: '6k1/p4ppp/1p6/3pP3/8/8/PP3PPP/6K1 w - - 0 1',
      options: ['Yes', 'No'],
      answer: 1,
      explain: 'No. En passant is only allowed on the move right after the jump.',
    },
  ],
};

const promotion: Lesson = {
  id: 'promotion',
  title: 'Promotion',
  blurb: 'A pawn that reaches the end becomes a queen.',
  icon: 'queen',
  intro: {
    text: [
      'A pawn that reaches the far end of the board is promoted. It turns into a queen, rook, bishop or knight of its own colour.',
      'Players almost always choose a queen. In these lessons, your pawn always becomes one.',
    ],
    demo: {
      fen: '8/8/4P3/8/8/8/8/8 w - - 0 1',
      moves: ['e6e7', 'e7e8q', 'e8a4', 'a4h4'],
    },
  },
  tasks: [
    {
      type: 'collect',
      prompt: 'Promote the pawn, then collect the stars with your new queen.',
      fen: '8/8/4P3/8/8/8/8/8 w - - 0 1',
      stars: ['e8', 'a4', 'h4'],
      par: 4,
    },
    {
      type: 'capture',
      prompt: 'A pawn can promote by capturing, too. Then clear the board.',
      fen: 'b6r/6P1/8/8/8/8/8/n7 w - - 0 1',
      par: 3,
      hint: 'Pawns capture diagonally, even on the last move.',
    },
    {
      type: 'moves',
      prompt: 'Promote your pawn before the knight can take it.',
      fen: '8/1P3pkp/3n4/8/8/8/6K1/8 w - - 0 1',
      steps: [{ accept: ['b7b8q'] }],
      explain: 'A pawn worth 1 became a queen worth 9.',
    },
    {
      type: 'moves',
      prompt: 'Promote with checkmate.',
      fen: '6k1/3P1ppp/8/p7/1n6/8/5PPP/6K1 w - - 0 1',
      steps: [{ accept: 'mate' }],
      explain: "The new queen checks along the back row, and Black's own pawns block the king's escape.",
    },
  ],
};

export const special = [castling, enPassant, promotion];
