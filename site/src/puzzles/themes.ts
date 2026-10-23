/**
 * The themes the theme list offers, in lichess's vocabulary (the puzzle data uses its tag names), with Kibitz's
 * own names and one-line descriptions. Tags not listed here (crushing, master, and so on) aren't offered.
 */
export interface ThemeInfo {
  id: string;
  label: string;
  blurb: string;
}

const t = (id: string, label: string, blurb: string): ThemeInfo => ({ id, label, blurb });

export const THEME_GROUPS: { title: string; themes: ThemeInfo[] }[] = [
  {
    title: 'Tactics',
    themes: [
      t('fork', 'Fork', 'One piece attacks two at once.'),
      t('pin', 'Pin', "A piece can't move without exposing something worth more behind it."),
      t('skewer', 'Skewer', 'Attack a valuable piece; take the one behind it when it moves.'),
      t('discoveredAttack', 'Discovered attack', 'Move one piece out of the way and another one attacks.'),
      t('discoveredCheck', 'Discovered check', 'Move one piece and another gives check.'),
      t('doubleCheck', 'Double check', 'Check from two pieces: only the king can answer.'),
      t('hangingPiece', 'Hanging piece', "Something is left unprotected. Take it."),
      t('trappedPiece', 'Trapped piece', 'A piece with nowhere to go. Win it.'),
      t('sacrifice', 'Sacrifice', 'Give material now to get more back.'),
      t('deflection', 'Deflection', 'Pull a defender away from what it guards.'),
      t('attraction', 'Attraction', 'Lure a piece, often the king, onto a bad square.'),
      t('capturingDefender', 'Remove the defender', 'Take the piece holding everything together.'),
      t('clearance', 'Clearance', 'Get a piece out of the way, with tempo.'),
      t('interference', 'Interference', 'Block the line between two enemy pieces.'),
      t('intermezzo', 'In-between move', 'Before the expected move, a stronger one.'),
      t('xRayAttack', 'X-ray', 'A piece works through another one on the same line.'),
      t('quietMove', 'Quiet move', 'No check, no capture, and still decisive.'),
      t('defensiveMove', 'Defence', 'The only move that saves the position.'),
      t('zugzwang', 'Zugzwang', 'Any move they make will hurt them.'),
    ],
  },
  {
    title: 'Checkmates',
    themes: [
      t('mateIn1', 'Mate in 1', 'One move to checkmate.'),
      t('mateIn2', 'Mate in 2', 'Two moves, every reply covered.'),
      t('mateIn3', 'Mate in 3', 'Three moves of forcing play.'),
      t('mateIn4', 'Mate in 4', 'A longer mating attack.'),
      t('mateIn5', 'Mate in 5+', 'For when you want to calculate.'),
      t('backRankMate', 'Back-rank mate', 'The king is boxed in by its own pawns.'),
      t('smotheredMate', 'Smothered mate', 'A knight mates a king hemmed in by its own pieces.'),
      t('anastasiaMate', "Anastasia's mate", 'Knight and rook trap the king on the edge.'),
      t('arabianMate', 'Arabian mate', 'Knight and rook mate in the corner.'),
      t('bodenMate', "Boden's mate", 'Two bishops on crossing diagonals.'),
      t('doubleBishopMate', 'Two-bishop mate', 'Two bishops side by side.'),
      t('dovetailMate', 'Dovetail mate', "The queen mates; the king's own pieces block its escape."),
      t('hookMate', 'Hook mate', 'Rook, knight and pawn together.'),
      t('operaMate', 'Opera mate', 'Rook and bishop on the back rank, as in Morphy\'s Opera Game.'),
      t('pillsburysMate', "Pillsbury's mate", 'Rook and bishop against a castled king.'),
      t('epauletteMate', 'Epaulette mate', 'The king is flanked by its own pieces.'),
      t('cornerMate', 'Corner mate', 'Rook and knight mate the cornered king.'),
      t('swallowstailMate', "Swallow's tail", 'The queen mates head-on; the king\'s own pieces sit beside it.'),
      t('morphysMate', "Morphy's mate", 'Bishop and rook against the cornered king.'),
      t('triangleMate', 'Triangle mate', 'Queen and rook in a triangle around the king.'),
      t('blindSwineMate', 'Blind swine mate', 'Two rooks on the seventh rank.'),
      t('killBoxMate', 'Kill box mate', 'Rook and queen build a box around the king.'),
      t('vukovicMate', 'Vuković mate', 'Rook, knight and king together.'),
      t('balestraMate', 'Balestra mate', 'Bishop and queen from a distance.'),
    ],
  },
  {
    title: 'Phases',
    themes: [
      t('opening', 'Opening', 'Tactics in the first moves of the game.'),
      t('middlegame', 'Middlegame', 'Tactics with most pieces still on the board.'),
      t('endgame', 'Endgame', 'Few pieces left; every move counts.'),
      t('pawnEndgame', 'Pawn endgames', 'Kings and pawns only.'),
      t('rookEndgame', 'Rook endgames', 'The most common endgame of all.'),
      t('bishopEndgame', 'Bishop endgames', 'Bishops and pawns.'),
      t('knightEndgame', 'Knight endgames', 'Knights and pawns.'),
      t('queenEndgame', 'Queen endgames', 'Queens and pawns.'),
      t('queenRookEndgame', 'Queen and rook endgames', 'Queens, rooks and pawns.'),
    ],
  },
  {
    title: 'Special moves and ideas',
    themes: [
      t('advancedPawn', 'Advanced pawn', 'A pawn close to promoting.'),
      t('promotion', 'Promotion', 'Make a new queen, or something else.'),
      t('underPromotion', 'Underpromotion', 'Promote to a knight, rook or bishop.'),
      t('enPassant', 'En passant', 'The special pawn capture.'),
      t('castling', 'Castling', 'Castle your way to the win.'),
      t('attackingF2F7', 'Attacking f2 or f7', 'The weakest square in the opening.'),
      t('kingsideAttack', 'Kingside attack', 'Go after the castled king.'),
      t('queensideAttack', 'Queenside attack', 'Go after the king on the queenside.'),
      t('exposedKing', 'Exposed king', 'A king with no shelter.'),
    ],
  },
  {
    title: 'Length',
    themes: [
      t('oneMove', 'One move', 'A single move wins.'),
      t('short', 'Short', 'Two moves.'),
      t('long', 'Long', 'Three moves.'),
      t('veryLong', 'Very long', 'Four moves or more.'),
    ],
  },
];

export const THEMES: Record<string, ThemeInfo> = Object.fromEntries(THEME_GROUPS.flatMap((g) => g.themes.map((th) => [th.id, th])));

/** A tag's name for the tags shown after solving; unlisted tags get a readable version of their own name. */
export const themeLabel = (id: string) => THEMES[id]?.label ?? id.replace(/([A-Z])/g, ' $1').replace(/^./, (c) => c.toUpperCase());

/** Tags worth showing after a puzzle: the listed themes, in their list order. */
export const shownThemes = (tags: string[]) => {
  const order = Object.keys(THEMES);
  return tags.filter((tag) => tag in THEMES).sort((a, b) => order.indexOf(a) - order.indexOf(b));
};
