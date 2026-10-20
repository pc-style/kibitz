import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { registerHooks } from 'node:module';
import { Chess } from 'chess.js';

registerHooks({ resolve(specifier, context, next) {
  if (/^\.\.?\//.test(specifier) && !/\.[cm]?[jt]sx?$/.test(specifier)) specifier += '.ts';
  return next(specifier, context);
} });
const { BOTS, botMove, gameEnding, gamePgn, takeBack } = await import('../src/play/bots.ts');
const { LiveEngine } = await import('../src/engine.ts');

// Run the same bundled engine through the application's actual UCI client.
// Only the browser Worker transport is replaced with the engine's Node entry.
const workers = [];
class NodeEngineWorker {
  onmessage = null;
  onerror = null;
  commands = [];
  stopped = false;
  constructor() {
    workers.push(this);
    this.proc = spawn(process.execPath, [new URL('../node_modules/stockfish/bin/stockfish-19-lite-single.js', import.meta.url).pathname], { stdio: ['pipe', 'pipe', 'pipe'] });
    let pending = '';
    this.proc.stdout.on('data', (data) => {
      pending += data.toString();
      const lines = pending.split('\n');
      pending = lines.pop();
      for (const line of lines) this.onmessage?.({ data: line.trim() });
    });
    this.proc.on('error', (err) => this.onerror?.({ message: err.message }));
    this.proc.on('exit', (code) => { if (!this.stopped) this.onerror?.({ message: `Engine exited: ${code}` }); });
    this.proc.stderr.on('data', (data) => { if (!this.stopped) this.onerror?.({ message: data.toString() }); });
  }
  postMessage(command) { this.commands.push(command); this.proc.stdin.write(command + '\n'); }
  terminate() { this.stopped = true; this.proc.kill(); }
}
globalThis.Worker = NodeEngineWorker;

const c = new Chess();
c.move('e4');
assert(takeBack(c, 'white'));
assert.equal(c.history().length, 0, 'take back while the reply is pending');
c.move('e4'); c.move('e5');
assert(takeBack(c, 'white'));
assert.equal(c.history().length, 0, 'take back a full turn');
c.move('e4');
assert.equal(takeBack(c, 'black'), false, 'Black cannot undo the engine opening before playing');
c.move('e5'); c.move('Nf3');
assert(takeBack(c, 'black'));
assert.deepEqual(c.history(), ['e4']);
c.move('e5'); c.move('Nf3'); c.move('Nc6');
const pgn = gamePgn(c, BOTS[2], 'black', '1-0');
const loaded = new Chess(); loaded.loadPgn(pgn);
assert.equal(loaded.getHeaders().White, 'Rook');
assert.equal(loaded.getHeaders().Black, 'You');
assert.equal(loaded.getHeaders().Result, '1-0');
assert.deepEqual(loaded.history(), c.history(), 'PGN preserves the exact game');
assert.equal(gameEnding(c, 'black', true).result, '1-0');
const mate = new Chess();
for (const move of ['f3', 'e5', 'g4', 'Qh4#']) mate.move(move);
assert.equal(gameEnding(mate, 'white', false).title, 'Checkmate. The bot won.');
assert.equal(gameEnding(mate, 'black', false).title, 'Checkmate. You won!');
const repetition = new Chess();
for (const move of ['Nf3', 'Nf6', 'Ng1', 'Ng8', 'Nf3', 'Nf6', 'Ng1', 'Ng8']) repetition.move(move);
assert.match(gameEnding(repetition, 'white', false).detail, /three times/);
assert.match(gameEnding(new Chess('7k/5Q2/6K1/8/8/8/8/8 b - - 0 1'), 'white', false).detail, /Stalemate/);
assert.match(gameEnding(new Chess('7k/8/6K1/8/8/8/8/8 w - - 0 1'), 'white', false).detail, /material/);
assert.match(gameEnding(new Chess('7k/8/6K1/8/8/8/R7/8 w - - 100 70'), 'white', false).detail, /Fifty/);
assert.equal(gameEnding(new Chess(), 'white', false), null);
const opening = new Chess();
const result = { best: 'e2e4', depth: 8, lines: [{ pv: ['d2d4'] }] };
assert.equal(botMove(opening, result, BOTS[2]), 'e2e4', 'use the weakened bestmove, not PV 1');
assert.notEqual(botMove(opening, result, BOTS[0], () => 0), 'e2e4', 'beginner can choose a random legal move');
assert.equal(botMove(mate, result, BOTS[0]), undefined);
mate.undo();
assert.equal(botMove(mate, result, BOTS[0], () => 0), 'd8h4', 'even beginner takes mate in one');
console.log('Game rules, both-color takebacks, weakened move selection, and PGN handoff passed.');

const engine = new LiveEngine();
try {
  const cancelled = engine.analyse(opening.fen(), 24);
  engine.stop();
  assert.equal(await cancelled, null, 'cancel during engine startup');
  const positions = [new Chess(), c, new Chess('7k/P7/6K1/8/8/8/8/8 w - - 0 1')];
  for (const bot of BOTS) {
    for (const position of positions) {
      const result = await engine.analyse(position.fen(), bot.depth, undefined, { skill: bot.skill, moveTime: bot.moveTime });
      assert(result);
      const move = botMove(position, result, bot);
      assert(position.moves({ verbose: true }).some((m) => m.lan === move), `${bot.name} must choose a legal reply`);
    }
    console.log(`${bot.name}: legal opening, middlegame, and promotion replies.`);
  }
  const oldSearch = engine.analyse(opening.fen(), 40, undefined, { moveTime: 3000 });
  const latest = engine.analyse(c.fen(), 10, undefined, { skill: 2, moveTime: 500, moves: c.history({ verbose: true }).map((m) => m.lan) });
  assert.equal(await oldSearch, null, 'a replaced search cannot answer the next turn');
  assert((await latest)?.best);
  assert(workers[0].commands.includes('position startpos moves e2e4 e7e5 g1f3 b8c6'), 'send history for repetition detection');
  await engine.analyse(c.fen(), 8, undefined, { moveTime: 500 });
  assert(workers[0].commands.slice(-3).includes('setoption name Skill Level value 20'), 'hints restore full strength');
  const pending = engine.analyse(opening.fen(), 40, undefined, { moveTime: 3000 });
  await new Promise((resolve) => setTimeout(resolve, 40));
  engine.stop();
  assert.equal(await pending, null, 'resignation/takeback cancellation discards an active search');
  const failed = engine.analyse(opening.fen(), 40, undefined, { moveTime: 3000 });
  await new Promise((resolve) => setTimeout(resolve, 40));
  workers[0].proc.kill();
  await assert.rejects(failed, /Engine exited/, 'worker failure must surface for retry');
} finally { engine.terminate(); }

const replacement = new LiveEngine();
try { assert((await replacement.analyse(c.fen(), 8, undefined, { moveTime: 500 }))?.best); }
finally { replacement.terminate(); }
console.log('LiveEngine cancellation, history, hint strength, failure and restart passed.');
