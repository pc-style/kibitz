import type { DrawShape } from '@lichess-org/chessground/draw';
import type { Key } from '@lichess-org/chessground/types';
import { Chess, DEFAULT_POSITION, validateFen, type Color, type Move, type PieceSymbol, type Square } from 'chess.js';
import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import { LiveEngine, type Line, type PositionEval } from '../engine';
import { lineToSan } from '../game';
import { winChance, type Score } from '../review';
import { useSettings } from '../settings';
import { boardHash, reviewHash } from '../sources';
import { Board, type Movable } from './board';
import { isPromotion, PromotionPicker } from './promotion';
import { EvalBar, NavIcon } from './review';
import './analysis.css';

const DEPTH = 22;
const LINES = 3;
/** At most this many engine updates reach the screen per second. */
const RENDERS_PER_SECOND = 10;
const ENGINE_KEY = 'kibitz:board-engine';
const SIDE = { w: 'White', b: 'Black' } as const;

/** A move on the board's line and the position it leads to. */
interface Played {
  san: string;
  uci: string;
  from: Key;
  to: Key;
  fen: string;
}

/** The line being explored: its starting position, its moves, and how many of them are on the board. */
interface Analysis {
  start: string;
  moves: Played[];
  index: number;
}

const fenAt = (a: Analysis) => (a.index ? a.moves[a.index - 1].fen : a.start);

/** Castling needs the king and that rook on their home squares; other claimed rights are dropped. */
const CASTLING: Record<string, [Color, Square, Square]> = {
  K: ['w', 'e1', 'h1'],
  Q: ['w', 'e1', 'a1'],
  k: ['b', 'e8', 'h8'],
  q: ['b', 'e8', 'a8'],
};

/**
 * Reads a pasted FEN into one the engine can search safely. Missing move counters are filled in,
 * castling rights the pieces can't back up are dropped, and impossible positions are refused.
 */
function readFen(input: string): string {
  const fields = input.trim().split(/\s+/);
  // Many sites copy only the first four fields.
  if (fields.length === 4) fields.push('0', '1');
  else if (fields.length === 5) fields.push('1');
  const valid = validateFen(fields.join(' '));
  if (!valid.ok) throw new Error(valid.error?.replace(/^Invalid FEN: /, '') ?? 'not a valid FEN');

  const placed = new Chess(fields.join(' '));
  const at = (square: Square, type: PieceSymbol, color: Color) => {
    const piece = placed.get(square);
    return piece?.type === type && piece.color === color;
  };
  fields[2] = [...fields[2]].filter((c) => CASTLING[c] && at(CASTLING[c][1], 'k', CASTLING[c][0]) && at(CASTLING[c][2], 'r', CASTLING[c][0])).join('') || '-';
  // Stockfish's network has room for 32 pieces.
  if (fields[0].replace(/[^A-Z]/g, '').length > 16 || fields[0].replace(/[^a-z]/g, '').length > 16) {
    throw new Error('a side has more than 16 pieces');
  }

  const chess = new Chess(fields.join(' '));
  const mover = chess.turn();
  const other = mover === 'w' ? 'b' : 'w';
  if (chess.isAttacked(chess.findPiece({ type: 'k', color: other })[0], mover)) {
    throw new Error(`${SIDE[other]} is in check with ${SIDE[mover]} to move`);
  }
  return chess.fen();
}

/** Plays a move where the board is; anything but the line's next move replaces the rest of the line. */
function playMove(a: Analysis, move: { from: string; to: string; promotion?: string }): Analysis {
  let m: Move;
  try {
    m = new Chess(fenAt(a)).move(move);
  } catch {
    return a;
  }
  if (a.moves[a.index]?.uci === m.lan) return { ...a, index: a.index + 1 };
  const played: Played = { san: m.san, uci: m.lan, from: m.from as Key, to: m.to as Key, fen: m.after };
  return { start: a.start, moves: [...a.moves.slice(0, a.index), played], index: a.index + 1 };
}

const uciMove = (uci: string) => ({ from: uci.slice(0, 2), to: uci.slice(2, 4), promotion: uci[4] });

/** Replays a line's moves from its start, so repetitions count. */
function replay(start: string, moves: Played[]): Chess {
  const chess = new Chess(start);
  for (const m of moves) chess.move(uciMove(m.uci));
  return chess;
}

interface Ending {
  text: string;
  result: '1-0' | '0-1' | '1/2-1/2';
}

/** Why the game is over in this position, if it is. */
function ending(chess: Chess): Ending | undefined {
  if (chess.isCheckmate()) {
    const winner = chess.turn() === 'w' ? 'b' : 'w';
    return { text: `Checkmate. ${SIDE[winner]} wins.`, result: winner === 'w' ? '1-0' : '0-1' };
  }
  const draw = chess.isStalemate()
    ? `Stalemate: ${SIDE[chess.turn()]} has no legal move, so it's a draw.`
    : chess.isInsufficientMaterial()
      ? "Draw: neither side has enough material to checkmate."
      : chess.isThreefoldRepetition()
        ? 'Draw by threefold repetition.'
        : chess.isDrawByFiftyMoves()
          ? 'Draw by the 50-move rule: 50 moves each without a capture or a pawn move.'
          : undefined;
  return draw ? { text: draw, result: '1/2-1/2' } : undefined;
}

const FINAL: Record<Ending['result'], Score> = {
  '1-0': { whiteWin: 100, whiteCp: 1000, label: '1-0' },
  '0-1': { whiteWin: 0, whiteCp: -1000, label: '0-1' },
  '1/2-1/2': { whiteWin: 50, whiteCp: 0, label: '½-½' },
};

/** An engine line's score from White's side, labelled like the review: +1.2, -0.4, M3, -M3. */
function whiteScore(line: Line, fen: string): Score {
  const sign = fen.split(' ')[1] === 'w' ? 1 : -1;
  if (line.mate !== undefined) {
    const m = line.mate * sign;
    return { whiteWin: m > 0 ? 100 : 0, whiteCp: m > 0 ? 1000 : -1000, label: `${m > 0 ? '' : '-'}M${Math.abs(m)}` };
  }
  const cp = (line.cp ?? 0) * sign;
  const pawns = Math.round(cp / 10) / 10;
  return { whiteWin: winChance(cp), whiteCp: Math.max(-1000, Math.min(1000, cp)), label: `${pawns > 0 ? '+' : ''}${pawns.toFixed(1)}` };
}

/** SAN with move numbers, the way a line is written: 12. Nf3 Nc6 13. Bb5, or 12… Nc6 13. Bb5. */
function numbered(fen: string, sans: string[]): string[] {
  const [, turn, , , , full] = fen.split(' ');
  let n = Number(full);
  let white = turn === 'w';
  return sans.map((san, i) => {
    const text = white ? `${n}. ${san}` : i === 0 ? `${n}… ${san}` : san;
    if (!white) n++;
    white = !white;
    return text;
  });
}

/** The whole line as PGN; chess.js adds the SetUp and FEN headers when it starts from another position. */
function linePgn(a: Analysis): string {
  const chess = replay(a.start, a.moves);
  chess.setHeader('Event', 'Kibitz analysis');
  chess.setHeader('White', 'White');
  chess.setHeader('Black', 'Black');
  const end = ending(chess);
  if (end) chess.setHeader('Result', end.result);
  return chess.pgn();
}

interface Live {
  fen: string;
  ev: PositionEval;
  done: boolean;
}

const message = (err: unknown) => (err instanceof Error ? err.message : String(err));

/** Free analysis board: play either side from any position, with Stockfish's best lines as you go. */
export function AnalysisBoard({ fen: initial }: { fen?: string }) {
  const settings = useSettings();
  // The route's FEN is read once; a bad one falls back to the start position and says why.
  const [opened] = useState(() => {
    try {
      return { fen: initial ? readFen(initial) : DEFAULT_POSITION };
    } catch (err) {
      return { fen: DEFAULT_POSITION, error: message(err) };
    }
  });
  const [line, setLine] = useState<Analysis>({ start: opened.fen, moves: [], index: 0 });
  const [notice, setNotice] = useState(opened.error);
  const [orientation, setOrientation] = useState<'w' | 'b'>('w');
  const [engineOn, setEngineOn] = useState(() => {
    try {
      return localStorage.getItem(ENGINE_KEY) !== 'off';
    } catch {
      return true; // Storage blocked: the switch just isn't remembered.
    }
  });
  const [promoting, setPromoting] = useState<{ from: Key; to: Key } | null>(null);
  const [live, setLive] = useState<Live | null>(null);
  const [failure, setFailure] = useState<string>();
  const [draft, setDraft] = useState<string | null>(null);
  const [fenError, setFenError] = useState<string>();
  const [copied, setCopied] = useState<{ what: 'fen' | 'pgn'; ok: boolean } | null>(null);
  // The line a reset threw away, until anything else changes the board.
  const [beforeReset, setBeforeReset] = useState<Analysis | null>(null);

  const fen = fenAt(line);
  const position = useMemo(() => {
    const chess = replay(line.start, line.moves.slice(0, line.index));
    const dests = new Map<Key, Key[]>();
    for (const m of chess.moves({ verbose: true })) dests.set(m.from as Key, [...(dests.get(m.from as Key) ?? []), m.to as Key]);
    return { turn: chess.turn(), dests, over: ending(chess) };
  }, [line]);
  const pgn = useMemo(() => linePgn(line), [line.start, line.moves]);

  // Every change of position retires a half-typed FEN, any old load error and an unanswered promotion.
  const change = (update: (a: Analysis) => Analysis) => {
    setLine(update);
    setPromoting(null);
    setDraft(null);
    setFenError(undefined);
    setNotice(undefined);
    setBeforeReset(null);
  };
  const reset = () => {
    const before = line;
    change(() => ({ start: DEFAULT_POSITION, moves: [], index: 0 }));
    if (before.moves.length || before.start !== DEFAULT_POSITION) setBeforeReset(before);
  };
  const go = (i: number) =>
    change((a) => {
      const index = Math.max(0, Math.min(a.moves.length, i));
      return index === a.index ? a : { ...a, index };
    });
  const flip = () => setOrientation((o) => (o === 'w' ? 'b' : 'w'));

  // A pawn reaching the last rank waits on the picker; meanwhile the board shows it as a queen.
  const movable = useMemo<Movable | undefined>(
    () =>
      promoting
        ? undefined
        : {
            color: position.turn === 'w' ? 'white' : 'black',
            dests: position.dests,
            onMove: (from, to) => (isPromotion(fen, from, to) ? setPromoting({ from, to }) : change((a) => playMove(a, { from, to }))),
          },
    [position, promoting],
  );
  const shownFen = useMemo(() => (promoting ? new Chess(fen).move({ ...promoting, promotion: 'q' }).after : fen), [fen, promoting]);

  const nav = useRef(line);
  nav.current = line;
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target;
      const typing = (t instanceof HTMLInputElement && t.type !== 'checkbox') || t instanceof HTMLTextAreaElement || t instanceof HTMLSelectElement;
      if (typing || e.metaKey || e.ctrlKey || e.altKey) return;
      const { index, moves } = nav.current;
      const map: Record<string, number> = { ArrowLeft: index - 1, ArrowRight: index + 1, ArrowUp: 0, Home: 0, ArrowDown: moves.length, End: moves.length };
      if (e.key in map) {
        e.preventDefault();
        go(map[e.key]);
      } else if (e.key === 'f') flip();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  // The address follows the position. replaceState adds no history entry and fires no hashchange,
  // so the app doesn't remount the board.
  useEffect(() => {
    history.replaceState(history.state, '', boardHash(fen));
  }, [fen]);

  // One warm engine while the switch is on. Switching off ends the worker, which also restarts a failed one.
  const engine = useRef<LiveEngine | null>(null);
  useEffect(() => {
    if (!engineOn) return;
    const e = new LiveEngine(LINES);
    engine.current = e;
    return () => {
      engine.current = null;
      e.terminate();
    };
  }, [engineOn]);

  const over = position.over;
  useEffect(() => {
    const e = engine.current;
    if (!e) return;
    if (over) {
      e.stop();
      return;
    }
    // Updates arrive many times a second; show the first at once, then at most every 100ms.
    let cancelled = false;
    let timer = 0;
    let shownAt = 0;
    let latest: PositionEval | null = null;
    const show = (done: boolean) => {
      timer = 0;
      shownAt = performance.now();
      if (latest && !cancelled) setLive({ fen, ev: latest, done });
    };
    e.analyse(fen, DEPTH, (ev) => {
      latest = ev;
      if (!timer) timer = window.setTimeout(() => show(false), Math.max(0, shownAt + 1000 / RENDERS_PER_SECOND - performance.now()));
    })
      .then((result) => {
        if (!result) return;
        clearTimeout(timer);
        latest = result;
        show(true);
      })
      // A rejection after cleanup is the engine being switched off or the page closing.
      .catch((err) => !cancelled && setFailure(message(err)));
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [fen, engineOn, !!over]);

  const toggleEngine = (on: boolean) => {
    setEngineOn(on);
    setLive(null);
    setFailure(undefined);
    try {
      localStorage.setItem(ENGINE_KEY, on ? 'on' : 'off');
    } catch {
      // Private mode: the switch still works for this visit.
    }
  };

  const current = live?.fen === fen ? live : null;
  const lines = current?.ev.lines ?? [];
  const best = engineOn ? lines[0]?.pv[0] : undefined;
  const shapes = useMemo<DrawShape[]>(
    () => (best && settings.arrows ? [{ orig: best.slice(0, 2) as Key, dest: best.slice(2, 4) as Key, brush: 'best' }] : []),
    [best, settings.arrows],
  );
  // The bar keeps the last evaluation until the new position's first one arrives, so stepping doesn't flash it to even.
  const score = over ? FINAL[over.result] : engineOn && live?.ev.lines[0] ? whiteScore(live.ev.lines[0], live.fen) : undefined;
  const shown = current?.ev.lines[0] ? whiteScore(current.ev.lines[0], fen) : over ? FINAL[over.result] : undefined;
  const last = line.index ? line.moves[line.index - 1] : undefined;

  const copy = (what: 'fen' | 'pgn', text: string) => {
    // The clipboard API is missing on plain-http origins; that lands in the failure branch too.
    Promise.resolve()
      .then(() => navigator.clipboard.writeText(text))
      .then(
        () => setCopied({ what, ok: true }),
        () => setCopied({ what, ok: false }),
      );
  };
  useEffect(() => {
    if (!copied) return;
    const timer = setTimeout(() => setCopied(null), 1600);
    return () => clearTimeout(timer);
  }, [copied]);
  const copyLabel = (what: 'fen' | 'pgn', label: string) => (copied?.what === what ? (copied.ok ? 'Copied' : "Couldn't copy") : label);

  const dirty = draft !== null && draft.trim() !== fen;
  const load = (e: Event) => {
    e.preventDefault();
    if (!dirty) return;
    try {
      const start = readFen(draft);
      change(() => ({ start, moves: [], index: 0 }));
    } catch (err) {
      setFenError(`That FEN didn't load: ${message(err)}.`);
    }
  };

  let status: string;
  if (over) status = 'Game over';
  else if (!engineOn) status = 'Engine off';
  else if (failure) status = 'Engine stopped';
  else if (!current) status = live ? 'Analysing…' : 'Starting Stockfish…';
  else status = current.done ? `Depth ${current.ev.depth}` : `Depth ${current.ev.depth}/${DEPTH}`;

  return (
    <div class={`review analysis ${settings.evalBar ? '' : 'review-no-bar'} ${engineOn ? '' : 'analysis-off'}`}>
      <section class="stage">
        <div class="board-row">
          {settings.evalBar ? <EvalBar score={score} orientation={orientation} /> : null}
          <div class="board">
            <Board
              fen={shownFen}
              orientation={orientation === 'w' ? 'white' : 'black'}
              lastMove={last ? [last.from, last.to] : undefined}
              shapes={shapes}
              movable={movable}
              coordinates={settings.coordinates}
              animate={settings.motion}
            />
            {promoting ? (
              <PromotionPicker
                square={promoting.to}
                color={position.turn === 'w' ? 'white' : 'black'}
                orientation={orientation === 'w' ? 'white' : 'black'}
                onPick={(piece) => change((a) => playMove(a, { ...promoting, promotion: piece }))}
                onCancel={() => setPromoting(null)}
              />
            ) : null}
          </div>
        </div>
        <p class="progress">
          {engineOn ? 'Stockfish 19 runs on your device. ' : ''}Arrows step through the line, Home and End jump to its ends, F flips
          the board.
        </p>
      </section>

      <aside class="panel">
        <h1 class="panel-title analysis-title">Analysis board</h1>
        {notice ? (
          <p class="form-error analysis-notice" role="alert">
            That position didn't load ({notice}), so the board starts from the beginning.
          </p>
        ) : null}

        <section class="analysis-engine" aria-label="Engine">
          <div class="analysis-engine-head">
            <span class={`analysis-eval analysis-eval-${shown && shown.whiteWin < 50 ? 'b' : 'w'}`} aria-label={shown ? `Evaluation ${shown.label}` : undefined}>
              {shown?.label ?? '–'}
            </span>
            <span class="analysis-depth">{status}</span>
            <label class="toggle analysis-switch">
              <span>Stockfish</span>
              <input type="checkbox" role="switch" checked={engineOn} onChange={(e) => toggleEngine((e.target as HTMLInputElement).checked)} />
            </label>
          </div>
          {engineOn && !over && !failure ? (
            <span
              class="progress-bar"
              role="progressbar"
              aria-label="Search depth"
              aria-valuemin={0}
              aria-valuemax={DEPTH}
              aria-valuenow={current?.ev.depth ?? 0}
              data-running={current?.done ? undefined : ''}
              style={`--done:${(current?.ev.depth ?? 0) / DEPTH}`}
            />
          ) : null}
          {over ? (
            <p class="analysis-over" role="status">
              {over.text}
            </p>
          ) : !engineOn ? (
            <p class="analysis-hint">Switch Stockfish on to see the best lines. Off saves battery.</p>
          ) : failure ? (
            <p class="progress-error analysis-hint">Engine stopped: {failure}. Switch it off and on to restart it.</p>
          ) : (
            <ol class="analysis-lines" aria-label="Best lines">
              {Array.from({ length: LINES }, (_, i) => {
                const l = lines[i];
                const sans = l ? numbered(fen, lineToSan(fen, l.pv, 10)) : [];
                if (!l || !sans.length) return <li key={i} class="analysis-line-empty" />;
                const s = whiteScore(l, fen);
                return (
                  <li key={i}>
                    <button type="button" class="analysis-line" onClick={() => change((a) => playMove(a, uciMove(l.pv[0])))} title={`Play ${sans[0]}`}>
                      <span class={`analysis-line-score analysis-eval-${s.whiteWin < 50 ? 'b' : 'w'}`}>{s.label}</span>
                      <span class="analysis-line-moves san">
                        <strong>{sans[0]}</strong> {sans.slice(1).join(' ')}
                      </span>
                    </button>
                  </li>
                );
              })}
            </ol>
          )}
        </section>

        <MoveList line={line} onSelect={go} />

        <nav class="controls" aria-label="Move navigation">
          <button type="button" onClick={() => go(0)} aria-label="First move" disabled={line.index === 0}>
            <NavIcon d="M7 6v12M18 6l-8 6 8 6z" />
          </button>
          <button type="button" onClick={() => go(line.index - 1)} aria-label="Previous move" disabled={line.index === 0}>
            <NavIcon d="M16 6l-8 6 8 6z" />
          </button>
          <button type="button" onClick={() => go(line.index + 1)} aria-label="Next move" disabled={line.index === line.moves.length}>
            <NavIcon d="M8 6l8 6-8 6z" />
          </button>
          <button type="button" onClick={() => go(line.moves.length)} aria-label="Last move" disabled={line.index === line.moves.length}>
            <NavIcon d="M17 6v12M6 6l8 6-8 6z" />
          </button>
          <button type="button" onClick={flip} aria-label="Flip board" title="Flip board (F)">
            <NavIcon d="M7 4v14M4 15l3 3 3-3M17 20V6M14 9l3-3 3 3" stroke />
          </button>
        </nav>

        <section class="analysis-tools" aria-label="Position">
          <form class="analysis-fen" onSubmit={load}>
            <label class="field">
              <span>FEN (paste one to load it)</span>
              <input
                value={draft ?? fen}
                onInput={(e) => setDraft((e.target as HTMLInputElement).value)}
                onFocus={(e) => (e.target as HTMLInputElement).select()}
                spellcheck={false}
                autocomplete="off"
                autocapitalize="off"
                aria-invalid={fenError ? true : undefined}
                aria-describedby={fenError ? 'fen-error' : undefined}
              />
            </label>
            {dirty ? (
              <button type="submit" class="button button-primary">
                Load
              </button>
            ) : (
              <button type="button" class="button" onClick={() => copy('fen', fen)}>
                {copyLabel('fen', 'Copy')}
              </button>
            )}
          </form>
          {fenError ? (
            <p id="fen-error" class="form-error" role="alert">
              {fenError}
            </p>
          ) : null}
          <div class="analysis-actions">
            <button type="button" class="button" onClick={() => copy('pgn', pgn)}>
              {copyLabel('pgn', 'Copy PGN')}
            </button>
            {line.moves.length ? (
              <a class="button" href={reviewHash(pgn, orientation)}>
                Review this line
              </a>
            ) : null}
            {beforeReset ? (
              <button type="button" class="button" onClick={() => change(() => beforeReset)}>
                Undo reset
              </button>
            ) : (
              <button type="button" class="button" onClick={reset} disabled={!line.moves.length && line.start === DEFAULT_POSITION}>
                Reset to start
              </button>
            )}
          </div>
        </section>
      </aside>
    </div>
  );
}

/** The line's moves in the review's scoresheet style; a line starting with Black gets an empty White cell first. */
function MoveList({ line, onSelect }: { line: Analysis; onSelect: (i: number) => void }) {
  const list = useRef<HTMLOListElement>(null);
  // Scroll the list itself, never the page: on phones the list sits below the board.
  useEffect(() => {
    const box = list.current;
    const row = box?.querySelector('[aria-current="true"]');
    if (!box || !row) return;
    const r = row.getBoundingClientRect();
    const b = box.getBoundingClientRect();
    const by = r.top < b.top ? r.top - b.top - 4 : r.bottom > b.bottom ? r.bottom - b.bottom + 4 : 0;
    if (by) box.scrollBy({ top: by });
  }, [line.index, line.moves.length]);

  if (!line.moves.length) {
    return <p class="moves analysis-moves-empty">Play a move for either side to start a line.</p>;
  }
  const [, turn, , , , full] = line.start.split(' ');
  const offset = turn === 'b' ? 1 : 0;
  const rows = Math.ceil((line.moves.length + offset) / 2);
  const cell = (i: number) => {
    const m = line.moves[i];
    if (!m) return <span class="move move-empty" />;
    return (
      <button type="button" class="move" aria-current={line.index === i + 1 ? 'true' : undefined} onClick={() => onSelect(i + 1)}>
        <span class="san">{m.san}</span>
      </button>
    );
  };
  return (
    <ol class="moves" ref={list} aria-label="Moves">
      {Array.from({ length: rows }, (_, r) => {
        const wi = r * 2 - offset;
        return (
          <li key={r}>
            <span class="moves-num">{Number(full) + r}.</span>
            {wi < 0 ? <span class="move move-empty" /> : cell(wi)}
            {cell(wi + 1)}
          </li>
        );
      })}
    </ol>
  );
}
