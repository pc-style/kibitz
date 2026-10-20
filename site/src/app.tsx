import { useEffect, useMemo, useState } from 'preact/hooks';
import { fetchGames, reviewHash, type GameSummary, type Site } from './sources';
import { parseGame } from './game';
import { GRADES } from './review';
import { Board } from './ui/board';
import { Piece } from './ui/piece';
import { GRADE_INFO, GradeIcon, badgeSvg } from './ui/grades';
import { CourseMap } from './learn/map';
import { LessonPage } from './learn/lesson';
import { LESSONS } from './learn/course';
import { dotShape } from './learn/play';
import { useStars } from './learn/progress';
import { AnalysisBoard } from './ui/analysis';
import { TopNav } from './ui/nav';
import { Review } from './ui/review';
import { reducedMotion } from './ui/theme';
import { PlayPage } from './play/page';

const OPERA_GAME = `[Event "Paris"]
[Site "Paris FRA"]
[Date "1858.??.??"]
[White "Paul Morphy"]
[Black "Duke Karl / Count Isouard"]
[Result "1-0"]

1. e4 e5 2. Nf3 d6 3. d4 Bg4 4. dxe5 Bxf3 5. Qxf3 dxe5 6. Bc4 Nf6 7. Qb3 Qe7 8. Nc3 c6 9. Bg5 b5
10. Nxb5 cxb5 11. Bxb5+ Nbd7 12. O-O-O Rd8 13. Rxd7 Rxd7 14. Rd1 Qe6 15. Bxd7+ Nxd7 16. Qb8+ Nxb8 17. Rd8# 1-0`;

type Route =
  | { page: 'home' }
  | { page: 'analysis' }
  | { page: 'board'; fen?: string }
  | { page: 'learn' }
  | { page: 'play' }
  | { page: 'lesson'; id: string }
  | { page: 'review'; pgn: string; orientation: 'w' | 'b' };

/** Pages live at #/learn, #/learn/<lesson>, #/analysis and #/board?fen=; reviews keep their #pgn= links. */
function readHash(): Route {
  const hash = location.hash.slice(1);
  if (hash.startsWith('/')) {
    const [path, query] = hash.split('?');
    const [section, id] = path.split('/').filter(Boolean);
    if (section === 'learn') return id ? { page: 'lesson', id } : { page: 'learn' };
    if (section === 'play') return { page: 'play' };
    if (section === 'analysis') return { page: 'analysis' };
    if (section === 'board') return { page: 'board', fen: new URLSearchParams(query).get('fen') ?? undefined };
    return { page: 'home' };
  }
  const params = new URLSearchParams(hash);
  const pgn = params.get('pgn');
  if (pgn) return { page: 'review', pgn, orientation: params.get('o') === 'b' ? 'b' : 'w' };
  return { page: 'home' };
}

export function App() {
  const [route, setRoute] = useState(readHash);
  useEffect(() => {
    const onHash = () => {
      const swap = () => {
        setRoute(readHash());
        window.scrollTo(0, 0);
      };
      if (!document.startViewTransition || reducedMotion()) return swap();
      // Crossfade between the start page and a review; Preact renders on the next microtask.
      document.startViewTransition(() => new Promise<void>((resolve) => (swap(), setTimeout(resolve))));
    };
    window.addEventListener('hashchange', onHash);
    return () => window.removeEventListener('hashchange', onHash);
  }, []);
  switch (route.page) {
    case 'review':
      return <Review key={route.pgn} pgn={route.pgn} orientation={route.orientation} />;
    case 'analysis':
      return <Analysis />;
    case 'board':
      return <AnalysisBoard key={route.fen} fen={route.fen} />;
    case 'learn':
      return <CourseMap />;
    case 'play':
      return <PlayPage />;
    case 'lesson':
      return <LessonPage key={route.id} id={route.id} />;
    default:
      return <Home />;
  }
}

/** The way in: Learn, Analysis, and a game against a bot. */
function Home() {
  const stars = useStars();
  const done = LESSONS.filter((l) => stars[l.id]).length;
  const next = LESSONS.find((l) => !stars[l.id]);
  const knightDots = useMemo(() => ['c2', 'e2', 'b3', 'f3', 'b5', 'f5', 'c6', 'e6'].map(dotShape), []);
  const opera = useOpera();

  return (
    <main class="home home-doors">
      <TopNav />
      <header class="home-head">
        <h1>
          <span>Learn. Play.</span> <span>Review every game.</span>
        </h1>
        <p class="home-lede">
          Learn how the pieces move, challenge a bot, or get every move of your last game graded. Free, no account, and it all runs
          in your browser.
        </p>
      </header>

      <a class="door" href="#/learn">
        <div class="door-board">
          <Board fen="8/8/8/8/3N4/8/8/8 w - - 0 1" orientation="white" shapes={knightDots} coordinates={false} />
        </div>
        <div class="door-body">
          <h2>Learn</h2>
          <p>
            From how the pieces move to your first checkmate, forks and pins. Short lessons you play on the board, then a
            game against a gentle bot.
          </p>
          <span class="door-cta">
            {done === 0 ? 'Start the first lesson' : next ? `Continue: ${next.title}` : 'Play the final game'} →
          </span>
          {done ? (
            <span class="door-meta">
              {done} of {LESSONS.length} lessons done
            </span>
          ) : null}
        </div>
      </a>

      <a class="door door-analysis" href="#/analysis">
        <div class="door-board">
          <Board fen={opera.ply.fenAfter} orientation="white" lastMove={[opera.ply.from, opera.ply.to]} shapes={opera.shapes} coordinates={false} />
        </div>
        <div class="door-body">
          <h2>Analysis</h2>
          <p>
            Every move of your game graded, from brilliant to blunder, with the move you should have played. Or open a
            free board with Stockfish.
          </p>
          <span class="door-cta">Review a game →</span>
        </div>
      </a>

      <a class="door door-play" href="#/play">
        <Piece role="king" color="black" class="door-opponent" />
        <div class="door-body">
          <h2>Play</h2>
          <p>Five opponents, from a forgiving first game to a Stockfish challenge. No clock, with hints and takebacks whenever you need them.</p>
          <span class="door-cta">Choose an opponent →</span>
        </div>
      </a>

      <Footer />
    </main>
  );
}

function Footer() {
  return (
    <footer class="home-foot">
      <p>
        On chess.com? The <a href="/kibitz-extension.zip">Kibitz extension</a> puts a <strong>Free review</strong> button on
        every finished game and opens it here. Unzip it, open <code>chrome://extensions</code>, turn on Developer mode, and
        choose Load unpacked.
      </p>
      <p>Grades follow chess.com's categories; accuracy uses lichess's published formula.</p>
    </footer>
  );
}

/** Morphy's queen sacrifice, 16. Qb8+, as the review shows it. */
function useOpera() {
  return useMemo(() => {
    const game = parseGame(OPERA_GAME);
    const ply = game.plies.find((p) => p.san === 'Qb8+')!;
    return { ply, shapes: [{ orig: ply.to, customSvg: { html: badgeSvg('brilliant') } }] };
  }, []);
}

const SITES: { id: Site; label: string }[] = [
  { id: 'chesscom', label: 'chess.com' },
  { id: 'lichess', label: 'lichess' },
];

function Analysis() {
  const [site, setSite] = useState<Site>(() => (localStorage.getItem('kibitz:site') as Site) || 'chesscom');
  const [username, setUsername] = useState(() => localStorage.getItem('kibitz:user') ?? '');
  const [games, setGames] = useState<GameSummary[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string>();
  const [pgn, setPgn] = useState('');

  const load = async (e: Event) => {
    e.preventDefault();
    const name = username.trim();
    if (!name) return;
    localStorage.setItem('kibitz:site', site);
    localStorage.setItem('kibitz:user', name);
    setLoading(true);
    setError(undefined);
    try {
      setGames(await fetchGames(site, name));
    } catch (err) {
      setGames(null);
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  };

  const me = username.trim().toLowerCase();
  const date = new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric' });
  // The hero shows a real moment from a real review.
  const opera = useOpera();

  return (
    <main class="home">
      <TopNav current="analysis" />
      <header class="home-head">
        <h1>
          <span>Every move graded.</span> <span>No paywall, no daily limit.</span>
        </h1>
        <p class="home-lede">
          Brilliant to blunder, accuracy for both sides, and the move you should have played. Stockfish runs on your own
          device, so the review costs nothing and your games never leave your browser.
        </p>
        <ul class="legend" aria-label="Move grades">
          {GRADES.map((g) => (
            <li key={g}>
              <GradeIcon grade={g} solid />
              {GRADE_INFO[g].label}
            </li>
          ))}
        </ul>
      </header>

      <a class="preview" href={reviewHash(OPERA_GAME)} aria-label="Open the review of Morphy's Opera Game, 1858">
        <div class="preview-board">
          <Board fen={opera.ply.fenAfter} orientation="white" lastMove={[opera.ply.from, opera.ply.to]} shapes={opera.shapes} />
        </div>
        <div class="coach preview-coach" style="--g:var(--g-brilliant)">
          <Piece role="knight" color="white" class="coach-avatar" />
          <div class="coach-body">
            <p class="coach-lead">
              <GradeIcon grade="brilliant" solid />
              <span>16. Qb8+ is brilliant!</span>
            </p>
            <p class="coach-detail">It gives up the queen, and mate follows.</p>
          </div>
        </div>
        <p class="preview-caption">
          Morphy vs Duke Karl / Count Isouard, Paris 1858 <span class="preview-open">Open the full review →</span>
        </p>
      </a>

      <section class="home-card" aria-labelledby="by-user">
        <h2 id="by-user">Your recent games</h2>
        <form class="home-form" onSubmit={load}>
          <div class="segmented" role="radiogroup" aria-label="Site">
            {SITES.map((s) => (
              <button type="button" role="radio" aria-checked={site === s.id} onClick={() => setSite(s.id)}>
                {s.label}
              </button>
            ))}
          </div>
          <label class="field">
            <span>Username</span>
            <input
              value={username}
              onInput={(e) => setUsername((e.target as HTMLInputElement).value)}
              autocomplete="username"
              spellcheck={false}
              required
            />
          </label>
          <button class="button button-primary" type="submit" disabled={loading}>
            {loading ? 'Loading…' : 'Show games'}
          </button>
        </form>
        {error ? (
          <p class="form-error" role="alert">
            {error}
          </p>
        ) : null}
        {games && !games.length ? <p class="muted">No recent finished standard games.</p> : null}
        {games?.length ? (
          <ul class="game-list">
            {games.map((g, i) => {
              const asBlack = g.black.toLowerCase() === me;
              const asWhite = g.white.toLowerCase() === me;
              const outcome =
                g.result === '½-½' ? 'draw' : !asWhite && !asBlack ? null : (g.result === '1-0') === asWhite ? 'won' : 'lost';
              return (
                <li key={g.id} style={`--i:${Math.min(i, 8)}`}>
                  <a href={reviewHash(g.pgn, asBlack ? 'b' : 'w')}>
                    <span class="game-date">{date.format(g.endedAt)}</span>
                    <span class="game-players">
                      <span class={asWhite ? 'me' : ''}>{g.white}</span>
                      {g.whiteElo ? <span class="elo"> {g.whiteElo}</span> : null}
                      <span class="vs"> vs </span>
                      <span class={asBlack ? 'me' : ''}>{g.black}</span>
                      {g.blackElo ? <span class="elo"> {g.blackElo}</span> : null}
                    </span>
                    <span class="game-speed">{g.speed}</span>
                    <span class={`game-result ${outcome ? `game-${outcome}` : ''}`}>
                      {outcome === 'won' ? 'Won' : outcome === 'lost' ? 'Lost' : outcome === 'draw' ? 'Draw' : g.result}
                    </span>
                  </a>
                </li>
              );
            })}
          </ul>
        ) : null}
      </section>

      <section class="home-card" aria-labelledby="by-pgn">
        <h2 id="by-pgn">Or paste a PGN</h2>
        <form
          class="home-form home-form-stack"
          onSubmit={(e) => {
            e.preventDefault();
            if (pgn.trim()) location.hash = reviewHash(pgn);
          }}
        >
          <label class="field">
            <span>PGN</span>
            <textarea rows={6} value={pgn} onInput={(e) => setPgn((e.target as HTMLTextAreaElement).value)} spellcheck={false} />
          </label>
          <button class="button" type="submit">
            Review this game
          </button>
        </form>
      </section>

      <section class="home-card home-board-card" aria-labelledby="by-board">
        <h2 id="by-board">Analysis board</h2>
        <p class="muted">Play out any idea or paste a position, with Stockfish's best lines as you go.</p>
        <a class="button" href="#/board">
          Open the board
        </a>
      </section>

      <Footer />
    </main>
  );
}
