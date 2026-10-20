import type { Key } from '@lichess-org/chessground/types';
import { Chess } from 'chess.js';
import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import { LiveEngine, type Line, type SearchResult } from '../engine';
import { reviewHash } from '../sources';
import type { Movable } from '../ui/board';
import { arrowShape, destsOf, play, playUci, uciOf } from './play';
import { saveStars } from './progress';
import { Coach, LessonBoard, Shell, useLater } from './ui';

/** The last stop of the course: a whole game against the practice bot. */
export const FINAL = { id: 'first-game', title: 'Your first game', blurb: 'A full game against a gentle bot, then its review.' };

type Side = 'white' | 'black';

/** A line's score for the side to move, with mates beyond any centipawn score. */
const lineScore = (l: Line) => (l.mate !== undefined ? (l.mate > 0 ? 100000 - l.mate : -100000 - l.mate) : (l.cp ?? 0));

/**
 * The practice bot is Stockfish at low depth, played loosely: about a third of its moves are random,
 * the rest are picked at random from its top lines within three pawns of the best. It still takes a mate when it sees one.
 */
function gentleMove(chess: Chess, result: SearchResult): string | undefined {
  const legal = chess.moves({ verbose: true });
  if (!legal.length) return undefined;
  if (Math.random() < 0.3) return uciOf(legal[Math.floor(Math.random() * legal.length)]);
  const best = result.lines[0] ? lineScore(result.lines[0]) : 0;
  const options = result.lines.filter((l) => l.pv[0] && best - lineScore(l) <= 300);
  return options.length ? options[Math.floor(Math.random() * options.length)].pv[0] : result.best;
}

function outcome(chess: Chess, side: Side, resigned: boolean) {
  const me = side[0];
  if (resigned) return { result: me === 'w' ? '0-1' : '1-0', stars: 1, lead: 'You resigned.', detail: 'Every game teaches something. Have a look at the review.' };
  if (chess.isCheckmate()) {
    const won = chess.turn() !== me;
    return won
      ? { result: me === 'w' ? '1-0' : '0-1', stars: 3, lead: 'Checkmate. You won.', detail: 'Your first win. The review will show your best moves and the ones to fix.' }
      : { result: me === 'w' ? '0-1' : '1-0', stars: 1, lead: 'Checkmate. The bot won.', detail: 'The review will show where the game turned.' };
  }
  const draw = (detail: string) => ({ result: '1/2-1/2', stars: 2, lead: 'A draw.', detail });
  if (chess.isStalemate()) return draw('Stalemate: the side to move has no legal move but is not in check.');
  if (chess.isInsufficientMaterial()) return draw('Neither side has enough pieces left to checkmate.');
  if (chess.isThreefoldRepetition()) return draw('The same position came up three times.');
  return draw('Fifty moves went by with no capture and no pawn move.');
}

export function BotGame() {
  const later = useLater();
  const engine = useRef<LiveEngine | null>(null);
  const game = useRef(new Chess());
  const [side, setSide] = useState<Side | null>(null);
  const [fen, setFen] = useState(game.current.fen());
  const [lastMove, setLastMove] = useState<Key[]>();
  const [thinking, setThinking] = useState(false);
  const [hint, setHint] = useState<string>();
  const [resigned, setResigned] = useState(false);

  useEffect(() => {
    engine.current = new LiveEngine(4);
    return () => engine.current?.terminate();
  }, []);

  const chess = game.current;
  const over = !!side && (resigned || chess.isGameOver());
  const end = over && side ? outcome(chess, side, resigned) : null;

  useEffect(() => {
    if (end) saveStars(FINAL.id, end.stars);
  }, [!!end]);

  const sync = () => {
    const c = game.current;
    const last = c.history({ verbose: true }).at(-1);
    setFen(c.fen());
    setLastMove(last ? [last.from as Key, last.to as Key] : undefined);
    setHint(undefined);
  };

  const botTurn = () => {
    const c = game.current;
    if (c.isGameOver()) return;
    setThinking(true);
    const started = Date.now();
    engine.current
      ?.analyse(c.fen(), 8)
      .then((r) => {
        if (!r) return;
        const uci = gentleMove(c, r);
        // A short pause so the reply doesn't land the instant you let go of your piece.
        later(
          () => {
            if (uci) playUci(c, uci);
            setThinking(false);
            sync();
          },
          Math.max(0, 600 - (Date.now() - started)),
        );
      })
      .catch(() => setThinking(false));
  };

  const start = (s: Side) => {
    game.current = new Chess();
    setSide(s);
    setResigned(false);
    sync();
    if (s === 'black') botTurn();
  };

  const myTurn = !!side && !over && !thinking && chess.turn() === side[0];
  const movable = useMemo<Movable | undefined>(() => {
    if (!myTurn || !side) return undefined;
    return {
      color: side,
      dests: destsOf(game.current),
      onMove: (orig, dest) => {
        if (!play(game.current, orig, dest)) return;
        sync();
        botTurn();
      },
    };
  }, [fen, myTurn]);

  const askHint = () => {
    engine.current
      ?.analyse(fen, 12)
      .then((r) => r?.lines[0]?.pv[0] && setHint(r.lines[0].pv[0]))
      .catch(() => {});
  };
  const takeBack = () => {
    if (!side) return;
    engine.current?.stop();
    chess.undo();
    if (chess.turn() !== side[0]) chess.undo();
    sync();
    if (chess.turn() !== side[0]) botTurn();
  };

  const shapes = useMemo(() => (hint && myTurn ? [arrowShape(hint)] : []), [hint, myTurn]);
  const history = chess.history();
  const board = <LessonBoard fen={fen} orientation={side ?? 'white'} lastMove={lastMove} shapes={shapes} movable={movable} />;

  if (!side) {
    return (
      <Shell title={FINAL.title} board={board}>
        <Coach lead="Time for a real game.">
          <p class="coach-detail">You play a full game against Kibitz's practice bot. It plays gently and makes mistakes, a lot like you will at first.</p>
          <p class="coach-detail">Hint shows a good move. Take back undoes your last move. When the game ends, you can see every move reviewed.</p>
        </Coach>
        <div class="lesson-actions">
          <button class="button button-primary" type="button" onClick={() => start('white')} autofocus>
            Play White
          </button>
          <button class="button" type="button" onClick={() => start('black')}>
            Play Black
          </button>
        </div>
      </Shell>
    );
  }

  return (
    <Shell title={FINAL.title} board={board}>
      {end ? (
        <Coach tone={end.stars === 3 ? 'good' : end.stars === 1 ? 'bad' : 'neutral'} lead={end.lead}>
          <p class="coach-detail">{end.detail}</p>
        </Coach>
      ) : (
        <Coach lead={thinking ? 'The bot is thinking…' : chess.inCheck() ? 'Check. Get your king to safety.' : 'Your move.'}>
          <p class="coach-line">
            You play {side === 'white' ? 'White' : 'Black'} · move {Math.floor(history.length / 2) + 1}
          </p>
        </Coach>
      )}

      {history.length ? (
        <ol class="bot-moves" aria-label="Moves">
          {history
            .filter((_, i) => i % 2 === 0)
            .map((san, i) => (
              <li key={i}>
                <span class="bot-move-n">{i + 1}.</span> {san} {history[i * 2 + 1] ?? ''}
              </li>
            ))}
        </ol>
      ) : null}

      <div class="lesson-actions">
        {end ? (
          <>
            <a class="button button-primary" href={reviewHash(pgnOf(chess, side, end.result), side === 'black' ? 'b' : 'w')}>
              Review this game
            </a>
            <button class="button" type="button" onClick={() => setSide(null)}>
              Play again
            </button>
          </>
        ) : (
          <>
            <button class="button" type="button" onClick={askHint} disabled={!myTurn}>
              Hint
            </button>
            <button class="button" type="button" onClick={takeBack} disabled={thinking || history.length < 2}>
              Take back
            </button>
            <button class="button" type="button" onClick={() => setResigned(true)} disabled={!history.length}>
              Resign
            </button>
          </>
        )}
      </div>
    </Shell>
  );
}

function pgnOf(chess: Chess, side: Side, result: string): string {
  const copy = new Chess();
  copy.loadPgn(chess.pgn());
  copy.setHeader('Event', 'Kibitz practice game');
  copy.setHeader('Date', new Date().toISOString().slice(0, 10).replaceAll('-', '.'));
  copy.setHeader('White', side === 'white' ? 'You' : 'Kibitz bot');
  copy.setHeader('Black', side === 'black' ? 'You' : 'Kibitz bot');
  copy.setHeader('Result', result);
  return copy.pgn();
}
