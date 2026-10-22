import { DEFAULT_POSITION } from 'chess.js';

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

/**
 * Fetches and reads the whole body, giving up after a while, so a stalled API (even one that stalls
 * part-way through the body) ends in a message instead of "Loading…" forever.
 */
async function fetchWithin(url: string, init: RequestInit = {}, ms = 15000): Promise<{ status: number; ok: boolean; text: string }> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), ms);
  try {
    const res = await fetch(url, { ...init, signal: ctrl.signal });
    return { status: res.status, ok: res.ok, text: await res.text() };
  } catch (err) {
    throw new Error(ctrl.signal.aborted ? 'The games site took too long to answer. Try again in a minute.' : "Couldn't reach the games site. Check your connection.", { cause: err });
  } finally {
    clearTimeout(timer);
  }
}

async function getJson<T>(url: string, notFound: string): Promise<T> {
  const res = await fetchWithin(url);
  if (res.status === 404) throw new Error(notFound);
  if (!res.ok) throw new Error(`The games API answered ${res.status}. Try again in a minute.`);
  return JSON.parse(res.text) as T;
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
  const { archives } = await getJson<{ archives: string[] }>(`${base}/archives`, 'No player with that username.');
  // chess.com sometimes lists a month whose archive then errors (seen for the current month), so skip failed months.
  const months = await Promise.allSettled(archives.slice(-3).map((url) => getJson<{ games: ChesscomGame[] }>(url, 'Archive missing.')));
  if (months.length && months.every((m) => m.status === 'rejected')) {
    throw new Error("chess.com's game archive isn't answering right now. Try again in a minute.");
  }
  return months
    .flatMap((m) => (m.status === 'fulfilled' ? m.value.games : []))
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
  const res = await fetchWithin(url, { headers: { Accept: 'application/x-ndjson' } }, 30000);
  if (res.status === 404) {
    // Lichess also answers 404 to requests it won't serve (it turns away some automated browsers), so check the player exists.
    const user = await fetchWithin(`https://lichess.org/api/user/${encodeURIComponent(username)}`).catch(() => null);
    throw new Error(user?.ok ? "Lichess didn't send that player's games. Try again in a minute, or paste a PGN." : 'No player with that username.');
  }
  if (!res.ok) throw new Error(`Lichess answered ${res.status}. Try again in a minute.`);
  const text = res.text;
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

/** Analysis board link for a position. Spaces become + (read back as spaces) so the FEN stays legible. */
export const boardHash = (fen: string) => (fen === DEFAULT_POSITION ? '#/board' : `#/board?fen=${fen.replaceAll(' ', '+')}`);

/** Review link for a PGN. Clock and eval comments are dropped to keep the link short. */
export function reviewHash(pgn: string, orientation: 'w' | 'b' = 'w'): string {
  const compact = pgn.replace(/\s*\{[^}]*\}/g, '').replace(/\s*\$\d+/g, '');
  const params = new URLSearchParams({ pgn: compact });
  if (orientation === 'b') params.set('o', 'b');
  return `#${params}`;
}
