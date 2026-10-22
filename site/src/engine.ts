/** One engine line. Scores are from the side to move's point of view, moves are UCI. */
export interface Line {
  cp?: number;
  mate?: number;
  pv: string[];
}

export interface PositionEval {
  depth: number;
  lines: Line[];
}

/** A finished search: the lines it reached and the move the engine would play (none when the game is over). */
export interface SearchResult extends PositionEval {
  best?: string;
}

export interface SearchOptions {
  skill?: number;
  moveTime?: number;
  /** Moves from the standard start position, so the engine can see repetitions. */
  moves?: string[];
}

const ENGINE_URL = '/engine/stockfish-19-lite-single.js';

function parseInfo(line: string): { depth: number; multipv: number; line: Line } | null {
  if (!line.startsWith('info ')) return null;
  const depth = /\bdepth (\d+)/.exec(line);
  const score = /\bscore (cp|mate) (-?\d+)( (?:lower|upper)bound)?/.exec(line);
  const pv = / pv (.+)$/.exec(line);
  if (!depth || !score || score[3] || !pv) return null;
  const value = Number(score[2]);
  return {
    depth: Number(depth[1]),
    multipv: Number(/\bmultipv (\d+)/.exec(line)?.[1] ?? 1),
    line: { ...(score[1] === 'cp' ? { cp: value } : { mate: value }), pv: pv[1].trim().split(' ') },
  };
}

class Engine {
  private worker = new Worker(ENGINE_URL);
  private onLine: ((line: string) => void) | null = null;
  private onFail: ((err: Error) => void) | null = null;
  private failure: Error | null = null;

  constructor() {
    this.worker.onmessage = (e) => this.onLine?.(String(e.data));
    this.worker.onerror = (e) => this.onFail?.(new Error(e.message || 'The engine failed to load.'));
  }

  private request(commands: string[], handle: (line: string, done: () => void) => void, timeout = 30000): Promise<void> {
    if (this.failure) return Promise.reject(this.failure);
    return new Promise((resolve, reject) => {
      const cleanup = () => {
        clearTimeout(timer);
        this.onLine = this.onFail = null;
      };
      const done = () => {
        cleanup();
        resolve();
      };
      const fail = (error: Error) => {
        cleanup();
        // After a timeout we cannot match a late bestmove to its search. Retire
        // this worker; callers restart it explicitly instead of reusing stale output.
        this.failure = error;
        this.worker.terminate();
        reject(error);
      };
      const timer = setTimeout(() => fail(new Error('The engine took too long to answer.')), timeout);
      this.onLine = (line) => handle(line, done);
      this.onFail = fail;
      try {
        for (const c of commands) this.worker.postMessage(c);
      } catch (error) {
        fail(error instanceof Error ? error : new Error(String(error)));
      }
    });
  }

  async init(multipv = 2) {
    await this.request(['uci'], (line, done) => line === 'uciok' && done());
    await this.request(
      [`setoption name MultiPV value ${multipv}`, 'setoption name Hash value 32', 'isready'],
      (line, done) => line === 'readyok' && done(),
    );
  }

  async analyse(fen: string, depth: number, onUpdate?: (ev: PositionEval) => void, options: SearchOptions = {}): Promise<SearchResult> {
    const lines: Line[] = [];
    let reached = 0;
    let best: string | undefined;
    const position = options.moves ? `position startpos moves ${options.moves.join(' ')}` : `position fen ${fen}`;
    const commands = [
      `setoption name Skill Level value ${options.skill ?? 20}`,
      position,
      `go depth ${depth}${options.moveTime ? ` movetime ${options.moveTime}` : ''}`,
    ];
    await this.request(commands, (line, done) => {
      if (line.startsWith('bestmove')) {
        best = line.split(' ')[1];
        return done();
      }
      const info = parseInfo(line);
      if (!info) return;
      reached = Math.max(reached, info.depth);
      lines[info.multipv - 1] = info.line;
      onUpdate?.({ depth: reached, lines: lines.filter(Boolean) });
    }, options.moveTime ? options.moveTime + 20000 : 120000);
    return { depth: reached, lines: lines.filter(Boolean), best: best && best !== '(none)' ? best : undefined };
  }

  /** Ends the current search early; it still resolves with what it found. */
  stop() {
    if (!this.failure) this.worker.postMessage('stop');
  }

  terminate() {
    this.failure ??= new Error('stopped');
    this.worker.terminate();
    this.onFail?.(this.failure);
  }
}

/**
 * Analyses every position with a pool of single-threaded engines, one position per engine at a time.
 * Positions are handed out in order, so results stream in roughly from the first move to the last.
 */
export async function analysePositions(
  fens: (string | null)[],
  depth: number,
  onEval: (index: number, ev: PositionEval) => void,
  signal: AbortSignal,
): Promise<void> {
  const queue = fens.flatMap((fen, i) => (fen ? [{ fen, i }] : []));
  const size = Math.max(1, Math.min(4, (navigator.hardwareConcurrency || 2) - 1, queue.length));
  let next = 0;

  const run = async () => {
    const engine = new Engine();
    const stop = () => engine.terminate();
    signal.addEventListener('abort', stop);
    try {
      await engine.init();
      while (!signal.aborted && next < queue.length) {
        const { fen, i } = queue[next++];
        const ev = await engine.analyse(fen, depth);
        if (!signal.aborted) onEval(i, ev);
      }
    } finally {
      signal.removeEventListener('abort', stop);
      engine.terminate();
    }
  };

  try {
    await Promise.all(Array.from({ length: size }, run));
  } catch (err) {
    if (!signal.aborted) throw err;
  }
}

/**
 * One engine kept warm for an interactive board (analysis, lessons, the practice bot).
 * Each call to analyse() stops the previous search, so only the latest position gets an answer.
 */
export class LiveEngine {
  private engine = new Engine();
  private ready: Promise<void>;
  private current: Promise<unknown> = Promise.resolve();
  private token = 0;

  constructor(multipv = 1) {
    this.ready = this.engine.init(multipv);
    // A failed start surfaces from analyse(); don't also report it as unhandled.
    this.ready.catch(() => {});
  }

  /** Resolves once Stockfish has loaded (the first load downloads about 2 MB), so pages can say "loading" rather than "thinking". */
  whenReady(): Promise<void> {
    return this.ready;
  }

  /** Searches fen to depth, reporting each deeper result. Resolves null if a later call or stop() replaced it. */
  async analyse(fen: string, depth: number, onUpdate?: (ev: PositionEval) => void, options: SearchOptions = {}): Promise<SearchResult | null> {
    const token = ++this.token;
    this.engine.stop();
    await this.ready;
    await this.current.catch(() => {});
    if (token !== this.token) return null;
    const run = this.engine.analyse(fen, depth, (ev) => token === this.token && onUpdate?.(ev), options);
    this.current = run;
    const result = await run;
    return token === this.token ? result : null;
  }

  stop() {
    this.token++;
    this.engine.stop();
  }

  terminate() {
    this.token++;
    this.engine.terminate();
  }
}
