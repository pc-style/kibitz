import type { Key } from '@lichess-org/chessground/types';
import { Chess } from 'chess.js';
import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import { LiveEngine, type Line, type SearchResult } from '../engine';
import { reviewHash } from '../sources';
import type { Movable } from '../ui/board';
import { isPromotion, PromotionPicker } from '../ui/promotion';
import { arrowShape, destsOf, playUci, uciOf } from './play';
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
  const [promoting, setPromoting] = useState<{ from: Key; to: Key } | null>(null);
  const [engineFailed, setEngineFailed] = useState(false);
  const [hintState, setHintState] = useState<'busy' | 'failed' | null>(null);
  // Bumped by a new game, a resignation or a take-back, so a bot reply still on its way is dropped.
  const turn = useRef(0);

  useEffect(() => {
    engine.current = new LiveEngine(4);
    return () => {
      turn.current++;
      engine.current?.terminate();
    };
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
    setHintState(null);
  };

  const botTurn = () => {
    const c = game.current;
    if (c.isGameOver()) return;
    const id = ++turn.current;
    setThinking(true);
    setEngineFailed(false);
    const started = Date.now();
    engine.current
      ?.analyse(c.fen(), 8)
      .then((r) => {
        if (!r || id !== turn.current) return;
        const uci = gentleMove(c, r);
        // A short pause so the reply doesn't land the instant you let go of your piece.
        later(
          () => {
            if (id !== turn.current) return;
            if (uci) playUci(c, uci);
            setThinking(false);
            sync();
          },
          Math.max(0, 600 - (Date.now() - started)),
        );
      })
      .catch(() => {
        if (id !== turn.current) return;
        setThinking(false);
        setEngineFailed(true);
      });
  };

  /** Drops any reply in flight. */
  const cancelBot = () => {
    turn.current++;
    engine.current?.stop();
    setThinking(false);
  };

  // A failed engine is replaced; the bot moves again only if it is its turn.
  const replaceEngine = () => {
    engine.current?.terminate();
    engine.current = new LiveEngine(4);
    setEngineFailed(false);
  };
  const retry = () => {
    replaceEngine();
    if (side && game.current.turn() !== side[0]) botTurn();
  };

  const start = (s: Side) => {
    cancelBot();
    game.current = new Chess();
    setSide(s);
    setResigned(false);
    setPromoting(null);
    setEngineFailed(false);
    sync();
    if (s === 'black') botTurn();
  };

  const resign = () => {
    cancelBot();
    setPromoting(null);
    setResigned(true);
  };

  const playMine = (from: Key, to: Key, promotion?: string) => {
    if (!playUci(game.current, from + to + (promotion ?? 'q'))) return;
    sync();
    botTurn();
  };

  const myTurn = !!side && !over && !thinking && !engineFailed && chess.turn() === side[0];
  const movable = useMemo<Movable | undefined>(() => {
    if (!myTurn || !side || promoting) return undefined;
    return {
      color: side,
      dests: destsOf(game.current),
      onMove: (orig, dest) => (isPromotion(fen, orig, dest) ? setPromoting({ from: orig, to: dest }) : playMine(orig, dest)),
    };
  }, [fen, myTurn, promoting]);
  // While the picker is open the board shows the pawn already promoted to a queen.
  const shownFen = useMemo(() => (promoting ? new Chess(fen).move({ ...promoting, promotion: 'q' }).after : fen), [fen, promoting]);

  const askHint = () => {
    if (!myTurn || hintState === 'busy' || !engine.current) return;
    const id = turn.current;
    setHintState('busy');
    engine.current
      .analyse(fen, 12)
      .then((r) => {
        if (id !== turn.current) return;
        const best = r?.lines[0]?.pv[0];
        if (best) setHint(best);
        // null means the search was replaced (you moved); anything else is a failure worth saying.
        setHintState(best || r === null ? null : 'failed');
      })
      .catch(() => {
        if (id !== turn.current) return;
        setHintState('failed');
        // A timed-out engine is retired; the next hint (and the bot) get a fresh one.
        replaceEngine();
      });
  };
  const takeBack = () => {
    if (!side) return;
    cancelBot();
    setPromoting(null);
    if (engineFailed) replaceEngine();
    chess.undo();
    if (chess.turn() !== side[0]) chess.undo();
    sync();
    if (chess.turn() !== side[0]) botTurn();
  };

  const shapes = useMemo(() => (hint && myTurn ? [arrowShape(hint)] : []), [hint, myTurn]);
  const history = chess.history();
  const board = (
    <LessonBoard
      fen={shownFen}
      orientation={side ?? 'white'}
      lastMove={lastMove}
      shapes={shapes}
      movable={movable}
      typing
      overlay={
        promoting && side ? (
          <PromotionPicker
            square={promoting.to}
            color={side}
            orientation={side}
            onPick={(piece) => {
              setPromoting(null);
              playMine(promoting.from, promoting.to, piece);
            }}
            onCancel={() => setPromoting(null)}
          />
        ) : null
      }
    />
  );

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
      ) : engineFailed ? (
        <Coach tone="bad" lead="The bot didn't answer.">
          <p class="coach-detail">Stockfish stopped or couldn't load in this browser. Try again, or reload the page.</p>
        </Coach>
      ) : (
        <Coach lead={thinking ? 'The bot is thinking…' : chess.inCheck() ? 'Check. Get your king to safety.' : 'Your move.'}>
          <p class="coach-line">
            You play {side === 'white' ? 'White' : 'Black'} · move {Math.floor(history.length / 2) + 1}
          </p>
          {myTurn && hintState === 'busy' ? <p class="coach-detail">Finding a good move for you…</p> : null}
          {myTurn && hintState === 'failed' ? <p class="coach-detail">The hint didn't load. Press Hint to try again.</p> : null}
          {myTurn && hint ? <p class="coach-detail">The arrow shows a good move.</p> : null}
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
            {engineFailed ? (
              <button class="button button-primary" type="button" onClick={retry}>
                Try again
              </button>
            ) : null}
            <button class="button" type="button" onClick={askHint} disabled={!myTurn || hintState === 'busy'}>
              {hintState === 'busy' ? 'Finding hint…' : 'Hint'}
            </button>
            <button class="button" type="button" onClick={takeBack} disabled={thinking || history.length < 2}>
              Take back
            </button>
            <button class="button" type="button" onClick={resign} disabled={!history.length}>
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
