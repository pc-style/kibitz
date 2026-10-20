import { useEffect, useState } from 'preact/hooks';
import { fetchGames, reviewHash, type GameSummary, type Site } from './sources';
import { Review } from './ui/review';

function readHash() {
  const params = new URLSearchParams(location.hash.slice(1));
  return { pgn: params.get('pgn'), orientation: params.get('o') === 'b' ? ('b' as const) : ('w' as const) };
}

export function App() {
  const [route, setRoute] = useState(readHash);
  useEffect(() => {
    const onHash = () => {
      setRoute(readHash());
      window.scrollTo(0, 0);
    };
    window.addEventListener('hashchange', onHash);
    return () => window.removeEventListener('hashchange', onHash);
  }, []);
  return route.pgn ? <Review key={route.pgn} pgn={route.pgn} orientation={route.orientation} /> : <Home />;
}

const SITES: { id: Site; label: string }[] = [
  { id: 'chesscom', label: 'chess.com' },
  { id: 'lichess', label: 'lichess' },
];

function Home() {
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

  return (
    <main class="home">
      <header class="home-head">
        <p class="wordmark">kibitz</p>
        <h1>Every move graded. No paywall, no daily limit.</h1>
        <p class="home-lede">
          Brilliant to blunder, accuracy for both sides, and the move you should have played. Stockfish runs on your own
          device, so the review costs nothing and your games never leave your browser.
        </p>
      </header>

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
            {games.map((g) => {
              const asBlack = g.black.toLowerCase() === me;
              return (
                <li key={g.id}>
                  <a href={reviewHash(g.pgn, asBlack ? 'b' : 'w')}>
                    <span class="game-date">{date.format(g.endedAt)}</span>
                    <span class="game-players">
                      <span class={g.white.toLowerCase() === me ? 'me' : ''}>{g.white}</span>
                      {g.whiteElo ? <span class="elo"> {g.whiteElo}</span> : null}
                      <span class="vs"> vs </span>
                      <span class={asBlack ? 'me' : ''}>{g.black}</span>
                      {g.blackElo ? <span class="elo"> {g.blackElo}</span> : null}
                    </span>
                    <span class="game-speed">{g.speed}</span>
                    <span class="game-result">{g.result}</span>
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

      <footer class="home-foot">
        <p>
          On chess.com? The <a href="/kibitz-extension.zip">Kibitz extension</a> puts a <strong>Free review</strong> button on
          every finished game and opens it here. Unzip it, open <code>chrome://extensions</code>, turn on Developer mode, and
          choose Load unpacked.
        </p>
        <p>Grades follow chess.com's categories; accuracy uses lichess's published formula.</p>
      </footer>
    </main>
  );
}
