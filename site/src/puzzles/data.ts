import INDEX from './index.json';

/**
 * The puzzles: a curated slice of lichess's database plus Kibitz's own, built by scripts/build-puzzles.py into
 * shards by a hash of the id. A shard is about 50 kB over the wire and holds puzzles of every rating and theme,
 * so one is enough to start, and a link to one puzzle needs only its own.
 */
const FILES = import.meta.glob<string>('./data/*.json', { eager: true, query: '?url', import: 'default' });
const URLS: Record<string, string> = {};
for (const [path, url] of Object.entries(FILES)) {
  const name = /\/data\/([\w-]+)\.json$/.exec(path)?.[1];
  if (name) URLS[name] = url;
}

export const SHARDS: number = INDEX.shards;
export const PUZZLE_COUNT: number = INDEX.count;
export const ORIGINAL_COUNT: number = INDEX.originals;
/** How many puzzles of each theme every shard holds, so a theme's puzzles can be found in the fewest downloads. */
export const THEME_COUNTS: Record<string, number[]> = INDEX.themes;
const SOURCE_COUNTS: Record<string, number[]> = INDEX.sources;

export type Source =
  | { kind: 'lichess'; game: string }
  | { kind: 'bots'; white: string; black: string }
  | { kind: 'tablebase'; material: string }
  | { kind: 'kibitz' };

export interface Puzzle {
  id: string;
  /** The position before the opponent's move that sets the puzzle up. */
  fen: string;
  /** UCI. The first is the opponent's; then yours, theirs, and so on, ending with yours. */
  moves: string[];
  rating: number;
  /** How sure that rating is (Glicko), which decides how much one puzzle moves yours. */
  rd: number;
  themes: string[];
  source: Source;
}

type Row = [id: string, fen: string, moves: string, rating: number, rd: number, themes: string, source: string];

function sourceOf(tag: string): Source {
  const [kind, ...rest] = tag.split(':');
  if (kind === 'l') return { kind: 'lichess', game: rest.join(':') };
  if (kind === 'b') return { kind: 'bots', white: rest[0], black: rest[1] };
  if (kind === 'e') return { kind: 'tablebase', material: rest[0] };
  return { kind: 'kibitz' };
}

const parse = ([id, fen, moves, rating, rd, themes, source]: Row): Puzzle => ({
  id,
  fen,
  moves: moves.split(' '),
  rating,
  rd,
  themes: themes ? themes.split(' ') : [],
  source: sourceOf(source),
});

/** 32-bit FNV-1a, as in scripts/build-puzzles.py (ids are ASCII, so code units are bytes). */
function fnv1a(text: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) h = Math.imul(h ^ text.charCodeAt(i), 0x01000193) >>> 0;
  return h;
}

export const shardOf = (id: string) => fnv1a(id) % SHARDS;

const loading = new Map<string, Promise<Puzzle[]>>();

/** Downloads a data file once; a failed download is tried again the next time it's asked for. */
function load(name: string): Promise<Puzzle[]> {
  let pending = loading.get(name);
  if (!pending) {
    const url = URLS[name];
    pending = (url ? fetch(url) : Promise.reject(new Error(`No puzzle file ${name}`)))
      .then((res) => {
        if (!res.ok) throw new Error(`Puzzles didn't load (${res.status}).`);
        return res.json() as Promise<Row[]>;
      })
      .then((rows) => rows.map(parse));
    pending.catch(() => loading.delete(name));
    loading.set(name, pending);
  }
  return pending;
}

export const loadShard = (n: number) => load(String(n));

let games: Promise<Record<string, string>> | null = null;

/** The moves of the bot game a Kibitz puzzle came from, up to the puzzle; downloaded only when asked for. */
export async function botGame(id: string): Promise<string | null> {
  const url = URLS.games;
  if (!url) return null;
  games ??= fetch(url).then((res) => {
    if (!res.ok) throw new Error(`The game didn't load (${res.status}).`);
    return res.json() as Promise<Record<string, string>>;
  });
  games.catch(() => (games = null));
  return (await games)[id] ?? null;
}

export async function findPuzzle(id: string): Promise<Puzzle | null> {
  return (await loadShard(shardOf(id))).find((p) => p.id === id) ?? null;
}

/** lichess's daily puzzles, in the order they were published; each day takes the next. */
export async function dailyPuzzle(day: string): Promise<Puzzle> {
  const days = Math.floor((Date.parse(day) - Date.parse(INDEX.dailyEpoch)) / 86_400_000);
  const n = ((days % INDEX.daily) + INDEX.daily) % INDEX.daily;
  const list = await load(`daily-${Math.floor(n / INDEX.dailyFile)}`);
  return list[n % INDEX.dailyFile];
}

/** Today in the player's own time zone, as YYYY-MM-DD: the daily puzzle changes at their midnight. */
export function today(at = new Date()): string {
  const local = new Date(at.getTime() - at.getTimezoneOffset() * 60_000);
  return local.toISOString().slice(0, 10);
}

/** What to draw puzzles from: everything, one theme, or one of Kibitz's own sources. */
export type Filter = { theme?: string; source?: 'bots' | 'tablebase' | 'kibitz' };

export const matches = (p: Puzzle, f: Filter) =>
  (!f.theme || p.themes.includes(f.theme)) &&
  (!f.source || (f.source === 'kibitz' ? p.source.kind === 'bots' || p.source.kind === 'tablebase' : p.source.kind === f.source));

/** How many puzzles a filter has in each shard. */
export function countsFor(f: Filter): number[] {
  if (f.theme) return THEME_COUNTS[f.theme] ?? [];
  if (f.source === 'kibitz') {
    const a = SOURCE_COUNTS.bots ?? [];
    const b = SOURCE_COUNTS.tablebase ?? [];
    return Array.from({ length: SHARDS }, (_, i) => (a[i] ?? 0) + (b[i] ?? 0));
  }
  if (f.source) return SOURCE_COUNTS[f.source] ?? [];
  return Array<number>(SHARDS).fill(1);
}

export const filterSize = (f: Filter) => (f.theme || f.source ? countsFor(f).reduce((a, b) => a + b, 0) : PUZZLE_COUNT);

/**
 * Hands out puzzles near a rating, downloading shards as it runs short. With a theme it starts with the shards
 * that have the most of that theme; without one, in a shuffled order, so two visits don't start the same way.
 */
export class PuzzlePool {
  private order: number[];
  private next = 0;
  private puzzles: Puzzle[] = [];

  constructor(private filter: Filter) {
    const counts = countsFor(filter);
    const shards = Array.from({ length: SHARDS }, (_, i) => i).filter((i) => (counts[i] ?? 0) > 0);
    for (let i = shards.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [shards[i], shards[j]] = [shards[j], shards[i]];
    }
    // Stable sort: the shuffle still breaks ties between shards with the same count.
    this.order = filter.theme || filter.source ? shards.sort((a, b) => counts[b] - counts[a]) : shards;
  }

  private loading: Promise<void> | null = null;

  get exhausted() {
    return this.next >= this.order.length && !this.loading;
  }

  /**
   * The next shard. One at a time, shared by every pick waiting on it; a shard only counts as read once it has
   * arrived, so a failed download is tried again rather than skipped.
   */
  private more(): Promise<void> {
    this.loading ??= loadShard(this.order[this.next])
      .then((shard) => {
        this.next++;
        this.puzzles.push(...shard.filter((p) => matches(p, this.filter)));
      })
      .finally(() => (this.loading = null));
    return this.loading;
  }

  /**
   * The unseen puzzle nearest `target`, picked at random among the closest few so the same rating doesn't
   * always give the same puzzle. `accept` can rule more out (Rush wants short ones early on); `signal` stops the
   * search between downloads.
   */
  async pick(target: number, seen: (id: string) => boolean, accept: (p: Puzzle) => boolean = () => true, signal?: AbortSignal): Promise<Puzzle | null> {
    for (;;) {
      // Whoever asked has gone: stop rather than download every remaining shard for nobody.
      if (signal?.aborted) return null;
      const open = this.puzzles.filter((p) => !seen(p.id) && accept(p));
      // Enough within reach of the target, or nothing more to download: choose.
      const near = open.filter((p) => Math.abs(p.rating - target) <= 150);
      if (near.length >= 6 || (this.exhausted && open.length)) {
        const pool = near.length ? near : open;
        pool.sort((a, b) => Math.abs(a.rating - target) - Math.abs(b.rating - target));
        const close = pool.slice(0, Math.max(6, pool.filter((p) => Math.abs(p.rating - target) <= 60).length));
        return close[Math.floor(Math.random() * close.length)];
      }
      if (this.exhausted) return null;
      await this.more();
    }
  }
}
