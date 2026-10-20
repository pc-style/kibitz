export type Site = 'chesscom' | 'lichess';

export interface GameSummary {
  id: string;
  white: string;
  black: string;
  whiteElo?: number;
  blackElo?: number;
  result: string;
  endedAt: number;
  speed?: string;
  pgn: string;
}

async function getJson<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, init);
  if (res.status === 404) throw new Error('No player with that username.');
  if (!res.ok) throw new Error(`The games API answered ${res.status}. Try again in a minute.`);
  return res.json() as Promise<T>;
}

interface ChesscomGame {
  url: string;
  pgn?: string;
  end_time: number;
  time_class: string;
  rules: string;
  white: { username: string; rating: number; result: string };
  black: { username: string; rating: number; result: string };
}

const chesscomResult = (g: ChesscomGame) => (g.white.result === 'win' ? '1-0' : g.black.result === 'win' ? '0-1' : '½-½');

async function chesscomGames(username: string): Promise<GameSummary[]> {
  const base = `https://api.chess.com/pub/player/${encodeURIComponent(username.toLowerCase())}/games`;
  const { archives } = await getJson<{ archives: string[] }>(`${base}/archives`);
  const months = await Promise.all(archives.slice(-2).map((url) => getJson<{ games: ChesscomGame[] }>(url)));
  return months
    .flatMap((m) => m.games)
    .filter((g) => g.rules === 'chess' && g.pgn)
    .sort((a, b) => b.end_time - a.end_time)
    .slice(0, 40)
    .map((g) => ({
      id: g.url,
      white: g.white.username,
      black: g.black.username,
      whiteElo: g.white.rating,
      blackElo: g.black.rating,
      result: chesscomResult(g),
      endedAt: g.end_time * 1000,
      speed: g.time_class,
      pgn: g.pgn!,
    }));
}

interface LichessGame {
  id: string;
  variant: string;
  speed: string;
  lastMoveAt: number;
  winner?: 'white' | 'black';
  status: string;
  players: Record<'white' | 'black', { user?: { name: string }; rating?: number; aiLevel?: number }>;
  pgn: string;
}

const lichessName = (p: LichessGame['players']['white']) => p.user?.name ?? (p.aiLevel ? `Stockfish level ${p.aiLevel}` : 'Anonymous');

async function lichessGames(username: string): Promise<GameSummary[]> {
  const url = `https://lichess.org/api/games/user/${encodeURIComponent(username)}?max=40&pgnInJson=true&clocks=false&evals=false&literate=false`;
  const res = await fetch(url, { headers: { Accept: 'application/x-ndjson' } });
  if (res.status === 404) throw new Error('No player with that username.');
  if (!res.ok) throw new Error(`Lichess answered ${res.status}. Try again in a minute.`);
  const text = await res.text();
  return text
    .split('\n')
    .filter(Boolean)
    .map((line) => JSON.parse(line) as LichessGame)
    .filter((g) => (g.variant === 'standard' || g.variant === 'fromPosition') && g.status !== 'aborted')
    .map((g) => ({
      id: g.id,
      white: lichessName(g.players.white),
      black: lichessName(g.players.black),
      whiteElo: g.players.white.rating,
      blackElo: g.players.black.rating,
      result: g.winner === 'white' ? '1-0' : g.winner === 'black' ? '0-1' : '½-½',
      endedAt: g.lastMoveAt,
      speed: g.speed,
      pgn: g.pgn,
    }));
}

export const fetchGames = (site: Site, username: string) => (site === 'chesscom' ? chesscomGames(username) : lichessGames(username));

/** Review link for a PGN. Clock and eval comments are dropped to keep the link short. */
export function reviewHash(pgn: string, orientation: 'w' | 'b' = 'w'): string {
  const compact = pgn.replace(/\s*\{[^}]*\}/g, '').replace(/\s*\$\d+/g, '');
  const params = new URLSearchParams({ pgn: compact });
  if (orientation === 'b') params.set('o', 'b');
  return `#${params}`;
}
