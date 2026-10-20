// Checks the Learn course in src/learn: every position, every par, the engine's view of every
// "right move", and the text limits. Prints each problem and exits non-zero if there are any.
// Usage: pnpm check:course [--engines N] [--depth D] [--only lesson-id,...] [--verbose]
import { spawn } from 'node:child_process';
import { registerHooks } from 'node:module';
import { Chess } from 'chess.js';

// The course is TypeScript with bundler-style imports ('./units/pieces'). Node strips the types;
// this adds the '.ts' those imports leave out.
registerHooks({
  resolve(specifier, context, next) {
    if (/^\.\.?\//.test(specifier) && !/\.[cm]?[jt]sx?$/.test(specifier)) specifier += '.ts';
    return next(specifier, context);
  },
});
const { COURSE, LESSONS } = await import('../src/learn/course.ts');

const args = process.argv.slice(2);
const opt = (name, fallback) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : fallback;
};
const ENGINES = Number(opt('engines', 3));
const DEPTH = Number(opt('depth', 18));
const MATE_DEPTH = Math.max(DEPTH, 30);
const MULTIPV = 4;
const MARGIN = 30;
const ONLY = opt('only', '')?.split(',').filter(Boolean) ?? [];
const VERBOSE = args.includes('--verbose');

/** The course outline the player and the saved progress rely on. */
const OUTLINE = {
  pieces: ['rook', 'bishop', 'queen', 'king', 'knight', 'pawn'],
  capturing: ['capture', 'piece-values', 'protect'],
  check: ['check', 'out-of-check', 'checkmate', 'stalemate'],
  special: ['castling', 'en-passant', 'promotion'],
  game: ['setup', 'game-end'],
  skills: ['forks', 'pins', 'back-rank', 'queen-mate', 'rook-mate', 'opening'],
};
const ICONS = ['pawn', 'knight', 'bishop', 'rook', 'queen', 'king'];

/**
 * Moves tasks where the engine's opinion doesn't apply, keyed 'lesson#task' (task counted from 1).
 * Every other moves task must play the engine's best move or one within MARGIN centipawns of it,
 * and must accept every move that good.
 */
const ENGINE_EXEMPT = {
  'castling#1': 'Asks for castling by name in a quiet opening where several moves are about as good.',
  'castling#2': 'Asks for castling by name in a quiet opening where several moves are about as good.',
  'castling#5': 'Tests which side may castle, not which move is best.',
  'en-passant#1': "The first move only sets up Black's two-square jump; other quiet moves would do as well.",
  'setup#5': 'Any first move is right: the task is only that White moves first.',
};

/**
 * Choose questions answered from the position itself. A question whose options all appear here is
 * checked against chess.js; see `positionState`.
 */
const STATE_OPTIONS = {
  Check: 'check',
  Checkmate: 'checkmate',
  Stalemate: 'stalemate',
};

const VALUES = { p: 1, n: 3, b: 3, r: 5, q: 9, k: 0 };
const material = (chess, color) =>
  chess
    .board()
    .flat()
    .reduce((sum, p) => sum + (p?.color === color ? VALUES[p.type] : 0), 0);
/** Is the black piece of this type guarded by another black piece? */
const guarded = (chess, type) => chess.attackers(chess.findPiece({ type, color: 'b' })[0], 'b').length > 0;
const ownKing = (chess) => chess.findPiece({ type: 'k', color: chess.turn() })[0];
const kingCanGo = (chess, square) =>
  chess.moves({ square: ownKing(chess), verbose: true }).some((m) => m.to === square);

/**
 * Other choose questions that chess.js can answer, keyed 'lesson#task'. Each returns the right
 * option index for the task's position.
 */
const FACTS = {
  // White, Black, Neither: who has more material, kings aside.
  'piece-values#1': (c) => {
    const lead = material(c, 'w') - material(c, 'b');
    return lead > 0 ? 0 : lead < 0 ? 1 : 2;
  },
  // The knight, the bishop: which one has no defender.
  'protect#1': (c) => (guarded(c, 'n') ? 1 : 0),
  // Yes, no: is it safe for the queen to take the knight?
  'protect#3': (c) => (guarded(c, 'n') ? 1 : 0),
  // Yes, no: can the white pawn move?
  'pawn#5': (c) => (c.moves({ square: c.findPiece({ type: 'p', color: 'w' })[0] }).length ? 0 : 1),
  // The rook, the bishop, the knight: which piece gives check.
  'check#1': (c) => {
    const checkers = c.attackers(ownKing(c), c.turn() === 'w' ? 'b' : 'w');
    return checkers.length === 1 ? ['r', 'b', 'n'].indexOf(c.get(checkers[0]).type) : -1;
  },
  // Yes, no: can the king move to the dotted square.
  'check#2': (c, t) => (kingCanGo(c, t.dots[0]) ? 0 : 1),
  // Yes, no: is short castling legal.
  'castling#3': (c) => (legalMoves(c).includes('e1g1') ? 0 : 1),
  // Yes, no: is either castling legal.
  'castling#4': (c) => (legalMoves(c).some((m) => m === 'e1g1' || m === 'e1c1') ? 0 : 1),
  // Yes, no: is an en passant capture legal.
  'en-passant#4': (c) => (c.moves({ verbose: true }).some((m) => m.isEnPassant()) ? 0 : 1),
  // The left one, the right one: which dotted square is light.
  'setup#1': (c, t) => t.dots.findIndex((s) => c.squareColor(s) === 'light'),
  // A rook, a knight, a bishop: what starts on the dotted squares.
  'setup#2': (c, t) => ['r', 'n', 'b'].indexOf(new Chess().get(t.dots[0])?.type),
  // King and queen swapped, knights and bishops swapped, nothing wrong.
  'setup#3': (c) => {
    const start = new Chess();
    const wrong = ['a1', 'b1', 'c1', 'd1', 'e1', 'f1', 'g1', 'h1'].filter((s) => c.get(s)?.type !== start.get(s)?.type);
    if (!wrong.length) return 2;
    return wrong.join() === 'd1,e1' ? 0 : wrong.join() === 'b1,c1,f1,g1' ? 1 : -1;
  },
  // White, Black: who moves first.
  'setup#4': (c) => (c.turn() === 'w' ? 0 : 1),
  // White can still win, a draw.
  'game-end#1': (c) => (c.isInsufficientMaterial() ? 1 : 0),
  // The game goes on, a draw.
  'game-end#2': (c) => (c.isDrawByFiftyMoves() ? 1 : 0),
  // Yes, no: does the pinned knight have a legal move.
  'pins#1': (c) => (c.moves({ square: c.findPiece({ type: 'n', color: c.turn() })[0] }).length ? 0 : 1),
  // Which arrow lets the king off the back row. Exactly one must.
  'back-rank#4': (c, t) => {
    const frees = t.arrows.map((uci) => {
      const after = new Chess(c.fen());
      play(after, uci);
      after.load(whiteAgain(after.fen()));
      return after.moves({ square: ownKing(after), verbose: true }).some((m) => m.to[1] === '2');
    });
    return frees.filter(Boolean).length === 1 ? frees.indexOf(true) : -1;
  },
};

/** Moves tasks that must end in a particular way, keyed 'lesson#task'. */
const ENDINGS = {
  'game-end#3': ['threefold repetition', (c) => c.isThreefoldRepetition()],
};

// ---------------------------------------------------------------------------------------------

const problems = [];
const fail = (where, message) => problems.push(`${where}: ${message}`);
const say = (line) => VERBOSE && console.log(line);

const SQUARE = /^[a-h][1-8]$/;
const UCI = /^[a-h][1-8][a-h][1-8]q?$/;
const BANNED = [/—/, /let's dive/i, /\bmaster/i, /\bjourney/i];

function lintText(where, text, max) {
  if (typeof text !== 'string' || !text.trim()) return fail(where, 'empty text');
  if (text.length > max) fail(where, `${text.length} characters, limit ${max}: "${text}"`);
  if (text.includes('\n')) fail(where, 'line break in text');
  for (const pattern of BANNED) if (pattern.test(text)) fail(where, `avoid ${pattern}: "${text}"`);
}

const hasBothKings = (fen) => /K/.test(fen.split(' ')[0]) && /k/.test(fen.split(' ')[0]);

/** Loads a full, legal position: both kings, the side not to move not in check, sane castling. */
function loadLegal(where, fen) {
  let chess;
  try {
    chess = new Chess(fen);
  } catch (e) {
    fail(where, `${e.message} (${fen})`);
    return null;
  }
  const [, turn, castling] = fen.split(' ');
  const other = turn === 'w' ? 'b' : 'w';
  const [king] = chess.findPiece({ type: 'k', color: other });
  if (chess.isAttacked(king, turn)) fail(where, `the side not to move is in check (${fen})`);
  const rights = { K: ['e1', 'h1', 'w'], Q: ['e1', 'a1', 'w'], k: ['e8', 'h8', 'b'], q: ['e8', 'a8', 'b'] };
  for (const flag of castling.replace('-', '')) {
    const [k, r, color] = rights[flag];
    const kp = chess.get(k);
    const rp = chess.get(r);
    if (kp?.type !== 'k' || kp.color !== color || rp?.type !== 'r' || rp.color !== color) {
      fail(where, `castling flag ${flag} without king and rook at home (${fen})`);
    }
  }
  return chess;
}

/** Loads a practice position that may leave out the kings. It is always White's turn there. */
function loadPractice(where, fen) {
  if (fen.split(' ').length !== 6) return fail(where, `FEN needs six fields (${fen})`), null;
  if (hasBothKings(fen)) return loadLegal(where, fen);
  const [board, turn, castling, ep] = fen.split(' ');
  if (turn !== 'w') fail(where, `positions without kings must be White to move (${fen})`);
  if (castling !== '-' || ep !== '-') fail(where, `positions without kings need no castling or en passant (${fen})`);
  const rows = board.split('/');
  if (rows.length !== 8) fail(where, `FEN needs eight rows (${fen})`);
  if (/[pP]/.test(rows[0] ?? '') || /[pP]/.test(rows[7] ?? '')) fail(where, `pawn on the first or last rank (${fen})`);
  try {
    return new Chess(fen, { skipValidation: true });
  } catch (e) {
    fail(where, `${e.message} (${fen})`);
    return null;
  }
}

const parseUci = (uci) => ({ from: uci.slice(0, 2), to: uci.slice(2, 4), promotion: uci[4] });

/** Plays a UCI move, or returns null if it is illegal. */
function play(chess, uci) {
  try {
    return chess.move(parseUci(uci));
  } catch {
    return null;
  }
}

/** Legal moves as UCI, with promotions to a queen only (the player always picks a queen). */
const legalMoves = (chess) =>
  chess
    .moves({ verbose: true })
    .filter((m) => !m.promotion || m.promotion === 'q')
    .map((m) => m.lan);

/** After a move in a practice position, hand the turn straight back to White. */
const whiteAgain = (fen) => {
  const f = fen.split(' ');
  return `${f[0]} w - - 0 1`;
};

function checkSquares(where, list, what) {
  for (const s of list ?? []) if (!SQUARE.test(s)) fail(where, `bad ${what} square '${s}'`);
}
function checkArrows(where, list) {
  for (const a of list ?? []) if (!/^[a-h][1-8][a-h][1-8]$/.test(a)) fail(where, `bad arrow '${a}'`);
}

function checkDemo(where, demo) {
  const chess = loadPractice(`${where} demo`, demo.fen);
  if (!chess) return;
  checkSquares(`${where} demo`, demo.dots, 'dot');
  checkArrows(`${where} demo`, demo.arrows);
  const kingless = !hasBothKings(demo.fen);
  for (const [i, uci] of (demo.moves ?? []).entries()) {
    if (!UCI.test(uci)) return fail(`${where} demo`, `move ${i + 1} '${uci}' is not UCI`);
    if (!play(chess, uci)) return fail(`${where} demo`, `move ${i + 1} '${uci}' is illegal at ${chess.fen()}`);
    if (kingless) chess.load(whiteAgain(chess.fen()), { skipValidation: true });
  }
}

/**
 * Fewest White moves that finish a collect or capture task, by breadth-first search.
 * Black never moves. Returns the count, or null if it can't be done within `cap` moves.
 */
function fewestMoves(where, fen, stars, cap) {
  const done = (board, left) => (stars ? left.length === 0 : !/[pnbrqk]/.test(board));
  const board0 = fen.split(' ')[0];
  const start = [board0, stars ? [...stars].sort() : []];
  if (done(...start)) return 0;
  const seen = new Set([`${start[0]}|${start[1]}`]);
  const chess = new Chess();
  let layer = [start];
  for (let depth = 1; depth <= cap; depth++) {
    const next = [];
    for (const [board, left] of layer) {
      chess.load(`${board} w - - 0 1`, { skipValidation: true });
      for (const uci of legalMoves(chess)) {
        chess.move(parseUci(uci));
        const after = chess.fen().split(' ')[0];
        chess.undo();
        const remaining = left.filter((s) => s !== uci.slice(2, 4));
        if (done(after, remaining)) return depth;
        const key = `${after}|${remaining}`;
        if (seen.has(key)) continue;
        seen.add(key);
        next.push([after, remaining]);
      }
    }
    if (seen.size > 3_000_000) return fail(where, 'search space too big to prove par'), null;
    layer = next;
  }
  return null;
}

function checkPractice(where, task) {
  const chess = loadPractice(where, task.fen);
  if (!chess) return;
  if (!Number.isInteger(task.par) || task.par < 1) return fail(where, `par must be a positive whole number`);
  let stars = null;
  if (task.type === 'collect') {
    stars = task.stars;
    if (!stars?.length) return fail(where, 'no stars');
    checkSquares(where, stars, 'star');
    if (new Set(stars).size !== stars.length) fail(where, 'the same star twice');
    for (const s of stars) if (chess.get(s)) fail(where, `star on ${s} sits on a piece`);
  } else if (!/[pnbrq]/.test(task.fen.split(' ')[0])) {
    return fail(where, 'nothing to capture');
  }
  const best = fewestMoves(where, task.fen, stars, task.par);
  if (best === null) {
    const real = fewestMoves(where, task.fen, stars, task.par + 8);
    fail(where, `can't be done in par ${task.par}${real ? `; it takes ${real}` : ''}`);
  } else if (best < task.par) fail(where, `par is ${task.par} but it takes only ${best}`);
  else say(`  ${where}: ${task.type} in ${best}, par ${task.par}`);
}

// --- Engine ----------------------------------------------------------------------------------

const ENGINE_FILE = new URL('../node_modules/stockfish/bin/stockfish-19-lite-single.js', import.meta.url).pathname;
const MATE = 100_000;
/** One number per score, from the side to move: centipawns, or near ±MATE for a forced mate. */
const toValue = (kind, n) => (kind === 'cp' ? n : n > 0 ? MATE - n : -MATE - n);
const isMateValue = (v) => Math.abs(v) > MATE / 2;
/** A move is as good as the best one if it is within MARGIN, or mates just as fast. */
const asGood = (v, best) => (isMateValue(best) ? v >= best : best - v <= MARGIN);
const showValue = (v) =>
  isMateValue(v) ? `mate ${v > 0 ? MATE - v : -(MATE + v)}` : `${v > 0 ? '+' : ''}${(v / 100).toFixed(2)}`;

class Engine {
  constructor() {
    // The engine script speaks UCI over stdin/stdout when run by Node; the pipes keep this
    // process alive while its WebAssembly loads.
    this.proc = spawn(process.execPath, [ENGINE_FILE], { stdio: ['pipe', 'pipe', 'inherit'] });
    this.queue = Promise.resolve();
    this.pending = 0;
    this.buffer = '';
    this.onLine = null;
    this.proc.stdout.on('data', (chunk) => {
      this.buffer += chunk;
      let i;
      while ((i = this.buffer.indexOf('\n')) >= 0) {
        const line = this.buffer.slice(0, i).trim();
        this.buffer = this.buffer.slice(i + 1);
        this.onLine?.(line);
      }
    });
    this.proc.on('exit', (code) => {
      if (this.onLine) {
        console.error(`Stockfish exited (${code}) mid-search`);
        process.exit(2);
      }
    });
  }

  /** Lines at the deepest finished depth, best first: { move, value }. */
  analyse({ fen, depth, multipv = 1, searchmoves = [] }) {
    this.pending++;
    const run = () =>
      new Promise((resolve) => {
        const lines = new Map();
        let deepest = 0;
        this.onLine = (line) => {
          const m = line.match(/^info depth (\d+) .*?multipv (\d+) score (cp|mate) (-?\d+)( lowerbound| upperbound)? .*? pv (\S+)/);
          if (m && !m[5]) {
            const d = Number(m[1]);
            if (d > deepest) deepest = d;
            lines.set(Number(m[2]), { depth: d, move: m[6], value: toValue(m[3], Number(m[4])) });
          }
          if (line.startsWith('bestmove')) {
            this.onLine = null;
            this.pending--;
            const result = [...lines.entries()]
              .sort(([a], [b]) => a - b)
              .map(([, l]) => l)
              .filter((l) => l.depth >= deepest - 1);
            if (deepest < depth) console.error(`warning: search stopped at depth ${deepest} for ${fen}`);
            resolve(result);
          }
        };
        const go = `go depth ${depth}${searchmoves.length ? ` searchmoves ${searchmoves.join(' ')}` : ''}`;
        this.proc.stdin.write(`ucinewgame\nsetoption name MultiPV value ${multipv}\nposition fen ${fen}\n${go}\n`);
      });
    const result = this.queue.then(run);
    this.queue = result;
    return result;
  }

  quit() {
    this.proc.stdin.write('quit\n');
  }
}

let engines = null;
function engine() {
  engines ??= Array.from({ length: ENGINES }, () => new Engine());
  return engines.reduce((a, b) => (b.pending < a.pending ? b : a));
}
let searches = 0;
const analyse = (job) => (searches++, engine().analyse(job));

/**
 * Asks the engine whether the accepted moves are the good ones: each must be best or within
 * MARGIN of best, and no other move may be that good.
 */
async function judge(where, fen, accepted) {
  const legal = legalMoves(new Chess(fen));
  let multipv = Math.min(MULTIPV, legal.length);
  let lines;
  for (;;) {
    lines = await analyse({ fen, depth: DEPTH, multipv });
    // If even the last line shown is as good as the best, look wider so nothing good hides.
    if (multipv >= legal.length || !asGood(lines.at(-1).value, lines[0].value)) break;
    multipv = Math.min(legal.length, multipv * 2);
  }
  // The learner can't underpromote, so those moves don't count.
  const values = new Map(lines.filter((l) => !/[rbn]$/.test(l.move)).map((l) => [l.move, l.value]));
  for (const uci of accepted) {
    if (values.has(uci)) continue;
    const [line] = await analyse({ fen, depth: DEPTH, searchmoves: [uci] });
    values.set(uci, line.value);
  }
  const best = Math.max(...values.values());
  const bestMove = [...values].find(([, v]) => v === best)[0];
  for (const uci of accepted) {
    if (!asGood(values.get(uci), best)) {
      fail(where, `accepts ${uci} (${showValue(values.get(uci))}) but ${bestMove} is ${showValue(best)} at ${fen}`);
    }
  }
  for (const [uci, v] of values) {
    if (!accepted.includes(uci) && asGood(v, best)) {
      fail(where, `${uci} (${showValue(v)}) is as good as the best (${showValue(best)}); accept it or change ${fen}`);
    }
  }
  say(`  ${where}: ${accepted.length <= 6 ? accepted.join(' ') : `${accepted.length} moves`} ok (best ${bestMove} ${showValue(best)})`);
}

// --- Tasks -----------------------------------------------------------------------------------

/** All accepted moves for a step, as UCI. */
function acceptedMoves(where, chess, accept) {
  const legal = chess.moves({ verbose: true }).filter((m) => !m.promotion || m.promotion === 'q');
  if (accept === 'check' || accept === 'mate') {
    const mark = accept === 'check' ? /[+#]$/ : /#$/;
    const moves = legal.filter((m) => mark.test(m.san)).map((m) => m.lan);
    if (!moves.length) fail(where, `no ${accept} is possible at ${chess.fen()}`);
    return moves;
  }
  if (!Array.isArray(accept) || !accept.length) return fail(where, 'accept is empty'), [];
  if (new Set(accept).size !== accept.length) fail(where, 'the same move accepted twice');
  for (const uci of accept) {
    if (!UCI.test(uci)) fail(where, `'${uci}' is not UCI (promotions end in q)`);
    else if (!legal.some((m) => m.lan === uci)) fail(where, `${uci} is illegal at ${chess.fen()}`);
  }
  return accept.filter((uci) => legal.some((m) => m.lan === uci));
}

async function checkMoves(where, task, key, engineOn) {
  if (!loadLegal(where, task.fen)) return;
  if (!task.steps?.length) return fail(where, 'no steps');
  const learner = task.fen.split(' ')[1];
  const judged = [];
  // Walk every branch: each accepted move, then the reply, then the next step.
  const walk = (fen, history, i) => {
    const chess = new Chess(fen);
    for (const uci of history) play(chess, uci);
    const step = task.steps[i];
    const here = `${where} step ${i + 1}`;
    if (chess.turn() !== learner) return fail(here, 'not the learner to move');
    const moves = acceptedMoves(here, chess, step.accept);
    if (engineOn && moves.length) judged.push(judge(here, chess.fen(), moves));
    const last = i === task.steps.length - 1;
    if (last && step.reply) fail(here, 'the last step has a reply');
    if (last && ENDINGS[key]) {
      const [name, holds] = ENDINGS[key];
      for (const uci of moves) {
        const end = new Chess(fen);
        for (const h of [...history, uci]) play(end, h);
        if (!holds(end)) fail(here, `${uci} doesn't end in ${name}`);
      }
    }
    if (!last && !step.reply) return fail(here, 'needs a reply');
    if (last) return;
    for (const uci of moves) {
      const after = new Chess(fen);
      for (const h of history) play(after, h);
      play(after, uci);
      if (!UCI.test(step.reply) || !play(after, step.reply)) {
        return fail(here, `reply ${step.reply} is illegal after ${uci} (${after.fen()})`);
      }
      walk(fen, [...history, uci, step.reply], i + 1);
    }
  };
  walk(task.fen, [], 0);
  await Promise.all(judged);
}

async function checkMate(where, task) {
  const chess = loadLegal(where, task.fen);
  if (!chess) return;
  if (chess.isGameOver()) return fail(where, 'the game is already over');
  const [line] = await analyse({ fen: task.fen, depth: MATE_DEPTH });
  if (!line || !isMateValue(line.value) || line.value < 0) {
    return fail(where, `the engine finds no forced mate (${line ? showValue(line.value) : 'no line'})`);
  }
  const distance = MATE - line.value;
  if (task.par < distance) fail(where, `par ${task.par} is below the engine's mate in ${distance}`);
  if (task.limit < task.par + 6) fail(where, `limit ${task.limit} leaves less than six moves over par ${task.par}`);
  say(`  ${where}: mate in ${distance}, par ${task.par}, limit ${task.limit}`);
}

/** What the position is, in the words of STATE_OPTIONS. */
function positionState(chess) {
  if (chess.isCheckmate()) return 'checkmate';
  if (chess.isStalemate()) return 'stalemate';
  if (chess.inCheck()) return 'check';
  return 'none';
}

function checkChoose(where, task, key) {
  const fen = task.fen;
  const chess = hasBothKings(fen) ? loadLegal(where, fen) : loadPractice(where, fen);
  if (!chess) return;
  if (!hasBothKings(fen)) fail(where, 'choose positions need both kings');
  if (!Array.isArray(task.options) || task.options.length < 2) return fail(where, 'needs two or more options');
  if (new Set(task.options).size !== task.options.length) fail(where, 'two options are the same');
  task.options.forEach((o, i) => lintText(`${where} option ${i + 1}`, o, 60));
  if (!Number.isInteger(task.answer) || task.answer < 0 || task.answer >= task.options.length) {
    return fail(where, `answer ${task.answer} is out of range`);
  }
  checkSquares(where, task.dots, 'dot');
  checkArrows(where, task.arrows);
  let verified = false;
  if (task.options.every((o) => o in STATE_OPTIONS)) {
    const state = positionState(chess);
    const right = task.options.findIndex((o) => STATE_OPTIONS[o] === state);
    if (right < 0) fail(where, `the position is '${state}', which no option names`);
    else if (right !== task.answer) fail(where, `the answer should be '${task.options[right]}' (chess.js says ${state})`);
    verified = true;
  }
  if (FACTS[key]) {
    const right = FACTS[key](chess, task);
    if (right !== task.answer) fail(where, `the answer should be option ${right + 1}, '${task.options[right]}'`);
    verified = true;
  }
  if (!verified && /\b(check|checkmate|mate|stalemate|castle|castling|en passant)\b/i.test(task.prompt)) {
    fail(where, 'asks about a rule chess.js can answer, but nothing checks the answer (add it to FACTS)');
  }
}

// --- Course ----------------------------------------------------------------------------------

/** A highlighted last move must be the other side's: its start is empty and its piece now stands on the target. */
function checkLastMove(where, task) {
  const chess = new Chess(task.fen, { skipValidation: true });
  const { from, to } = parseUci(task.lastMove);
  const piece = chess.get(to);
  if (chess.get(from)) fail(where, `last move ${task.lastMove} starts on an occupied square`);
  if (!piece || piece.color === chess.turn()) fail(where, `last move ${task.lastMove} does not end on a piece of the side that just moved`);
}

async function checkLesson(unit, lesson, seenIds) {
  const where = lesson.id;
  if (seenIds.has(lesson.id)) fail(where, 'duplicate lesson id');
  seenIds.add(lesson.id);
  lintText(`${where} title`, lesson.title, 40);
  lintText(`${where} blurb`, lesson.blurb, 70);
  if (!ICONS.includes(lesson.icon)) fail(where, `unknown icon '${lesson.icon}'`);
  const text = lesson.intro?.text ?? [];
  if (text.length < 1 || text.length > 3) fail(where, `intro has ${text.length} paragraphs (1 to 3)`);
  text.forEach((p, i) => lintText(`${where} intro ${i + 1}`, p, 240));
  if (!lesson.intro?.demo) fail(where, 'no demo');
  else checkDemo(where, lesson.intro.demo);
  const tasks = lesson.tasks ?? [];
  if (tasks.length < 3 || tasks.length > 6) fail(where, `${tasks.length} tasks (3 to 6)`);
  const jobs = [];
  for (const [i, task] of tasks.entries()) {
    const key = `${lesson.id}#${i + 1}`;
    const at = `${key} (${task.type})`;
    lintText(`${at} prompt`, task.prompt, 90);
    if (task.explain !== undefined) lintText(`${at} explain`, task.explain, 240);
    if (task.hint !== undefined) lintText(`${at} hint`, task.hint, 240);
    if (typeof task.fen !== 'string') {
      fail(at, 'no FEN');
      continue;
    }
    if (task.lastMove !== undefined) checkLastMove(at, task);
    if (task.type === 'collect' || task.type === 'capture') checkPractice(at, task);
    else if (task.type === 'moves') jobs.push(checkMoves(at, task, key, !(key in ENGINE_EXEMPT)));
    else if (task.type === 'mate') jobs.push(checkMate(at, task));
    else if (task.type === 'choose') checkChoose(at, task, key);
    else fail(at, `unknown task type '${task.type}'`);
    if (key in ENGINE_EXEMPT && task.type !== 'moves') fail(key, 'exempt from the engine but not a moves task');
  }
  await Promise.all(jobs);
  return tasks.length;
}

async function main() {
  const started = Date.now();
  const units = Object.keys(OUTLINE);
  const ids = COURSE.map((u) => u.id);
  if (ids.join() !== units.join()) fail('course', `units are [${ids}], expected [${units}]`);
  for (const unit of COURSE) {
    const lessons = unit.lessons.map((l) => l.id);
    const want = OUTLINE[unit.id] ?? [];
    if (lessons.join() !== want.join()) fail(unit.id, `lessons are [${lessons}], expected [${want}]`);
    lintText(`${unit.id} title`, unit.title, 40);
  }
  if (LESSONS.map((l) => l.id).join() !== COURSE.flatMap((u) => u.lessons.map((l) => l.id)).join()) {
    fail('course', 'LESSONS is not the lessons of COURSE in order');
  }
  for (const key of Object.keys({ ...ENGINE_EXEMPT, ...FACTS, ...ENDINGS })) {
    const [id, n] = key.split('#');
    if (!LESSONS.find((l) => l.id === id)?.tasks[Number(n) - 1]) fail('checker', `${key} names no task`);
  }

  const seenIds = new Set();
  let taskCount = 0;
  const jobs = [];
  for (const unit of COURSE) {
    for (const lesson of unit.lessons) {
      if (ONLY.length && !ONLY.includes(lesson.id)) continue;
      jobs.push(
        checkLesson(unit, lesson, seenIds).then((n) => {
          taskCount += n;
          console.log(`checked ${lesson.id} (${n} tasks)`);
        }),
      );
    }
  }
  await Promise.all(jobs);
  engines?.forEach((e) => e.quit());

  const seconds = ((Date.now() - started) / 1000).toFixed(0);
  if (problems.length) {
    console.error(`\n${problems.length} problem${problems.length === 1 ? '' : 's'}:`);
    for (const p of problems) console.error(`  ✗ ${p}`);
    process.exit(1);
  }
  const lessonCount = ONLY.length ? ONLY.length : LESSONS.length;
  console.log(`\nCourse OK: ${lessonCount} lessons, ${taskCount} tasks, ${searches} engine searches at depth ${DEPTH}, ${seconds}s.`);
}

await main();
