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

  constructor() {
    this.worker.onmessage = (e) => this.onLine?.(String(e.data));
    this.worker.onerror = (e) => this.onFail?.(new Error(e.message || 'The engine failed to load.'));
  }

  private request(commands: string[], handle: (line: string, done: () => void) => void): Promise<void> {
    return new Promise((resolve, reject) => {
      const done = () => {
        this.onLine = this.onFail = null;
        resolve();
      };
      this.onLine = (line) => handle(line, done);
      this.onFail = reject;
      for (const c of commands) this.worker.postMessage(c);
    });
  }

  async init() {
    await this.request(['uci'], (line, done) => line === 'uciok' && done());
    await this.request(
      ['setoption name MultiPV value 2', 'setoption name Hash value 32', 'isready'],
      (line, done) => line === 'readyok' && done(),
    );
  }

  async analyse(fen: string, depth: number): Promise<PositionEval> {
    const lines: Line[] = [];
    let reached = 0;
    await this.request([`position fen ${fen}`, `go depth ${depth}`], (line, done) => {
      if (line.startsWith('bestmove')) return done();
      const info = parseInfo(line);
      if (!info) return;
      reached = Math.max(reached, info.depth);
      lines[info.multipv - 1] = info.line;
    });
    return { depth: reached, lines: lines.filter(Boolean) };
  }

  terminate() {
    this.worker.terminate();
    this.onFail?.(new Error('stopped'));
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
