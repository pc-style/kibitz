import { useEffect, useState } from 'preact/hooks';

/** One finished puzzle, as the session strip and the history show it. */
export interface Attempt {
  id: string;
  ok: boolean;
  /** The puzzle's rating, and how much yours moved (0 when it wasn't rated). */
  rating: number;
  delta: number;
}

export type RushMode = '3' | '5' | 'survival';

/** Everything Puzzles remembers, kept in this browser only. */
export interface PuzzleProgress {
  /** Glicko-2: rating, deviation and volatility. Null until a starting level is chosen. */
  rating: number | null;
  rd: number;
  vol: number;
  played: number;
  solved: number;
  /** Rated puzzles aim this far from your rating: easier, normal or harder. */
  difficulty: -1 | 0 | 1;
  recent: Attempt[];
  /** Puzzles already played, newest last, so they don't come round again too soon. */
  seen: string[];
  rush: Record<RushMode, number>;
  /** Days (YYYY-MM-DD) whose daily puzzle was solved, or failed. */
  daily: Record<string, boolean>;
}

const KEY = 'kibitz:puzzles';
const DEFAULTS: PuzzleProgress = { rating: null, rd: 350, vol: 0.06, played: 0, solved: 0, difficulty: 0, recent: [], seen: [], rush: { '3': 0, '5': 0, survival: 0 }, daily: {} };

/** The level a new player picks to start from; Glicko's wide early deviation corrects it within a few puzzles. */
export const LEVELS = [
  { rating: 700, label: 'New to chess', detail: 'I know how the pieces move.' },
  { rating: 1100, label: 'Casual', detail: 'I play now and then.' },
  { rating: 1500, label: 'Club player', detail: 'I play often and know some tactics.' },
  { rating: 1900, label: 'Strong', detail: 'Tactics are my thing.' },
] as const;

const num = (v: unknown, lo: number, hi: number, fallback: number) => (typeof v === 'number' && Number.isFinite(v) ? Math.min(hi, Math.max(lo, v)) : fallback);

/** What storage holds, or null when it can't be read at all (blocked), which is not the same as empty. */
function read(): PuzzleProgress | null {
  let text: string | null;
  try {
    text = localStorage.getItem(KEY);
  } catch {
    return null;
  }
  return parse(text);
}

function parse(text: string | null): PuzzleProgress {
  try {
    const raw: unknown = JSON.parse(text ?? '{}');
    if (!raw || typeof raw !== 'object') return DEFAULTS;
    const s = raw as Partial<PuzzleProgress>;
    // Field by field, so a damaged save loses only the damaged part.
    const rush = (s.rush && typeof s.rush === 'object' ? s.rush : {}) as Partial<Record<RushMode, unknown>>;
    return {
      rating: s.rating == null ? null : num(s.rating, 100, 3500, 1500),
      rd: num(s.rd, 45, 350, 350),
      vol: num(s.vol, 0.01, 0.2, 0.06),
      played: num(s.played, 0, 1e9, 0),
      solved: num(s.solved, 0, 1e9, 0),
      difficulty: s.difficulty === -1 || s.difficulty === 1 ? s.difficulty : 0,
      recent: Array.isArray(s.recent)
        ? s.recent.filter((a): a is Attempt => !!a && typeof a.id === 'string' && typeof a.ok === 'boolean' && typeof a.rating === 'number' && typeof a.delta === 'number').slice(-30)
        : [],
      seen: Array.isArray(s.seen) ? s.seen.filter((id): id is string => typeof id === 'string').slice(-SEEN) : [],
      rush: { '3': num(rush['3'], 0, 1e4, 0), '5': num(rush['5'], 0, 1e4, 0), survival: num(rush.survival, 0, 1e4, 0) },
      daily: Object.fromEntries(Object.entries(s.daily && typeof s.daily === 'object' ? s.daily : {}).filter(([d, v]) => /^\d{4}-\d\d-\d\d$/.test(d) && typeof v === 'boolean')),
    };
  } catch {
    return DEFAULTS;
  }
}

/** Remembered puzzles: enough that a few weeks of solving doesn't repeat, small enough to stay a few kB. */
const SEEN = 4000;

let current = read() ?? DEFAULTS;
let seenSet = new Set(current.seen);
const listeners = new Set<(p: PuzzleProgress) => void>();
/** A write failed (private mode, full storage): from then on this tab's memory is the only full copy. */
let unsaved = false;

function save(next: PuzzleProgress) {
  current = next;
  seenSet = new Set(next.seen);
  try {
    localStorage.setItem(KEY, JSON.stringify(next));
    unsaved = false;
  } catch {
    // Progress lasts for this visit.
    unsaved = true;
  }
  for (const listen of listeners) listen(current);
}

/**
 * What a change starts from: storage, which another tab may have just written (its storage event can still be on
 * its way), unless writing has failed here, when memory holds progress storage doesn't.
 */
const latest = () => (unsaved ? current : (read() ?? current));

// Puzzles solved in another tab count here too, unless this tab holds progress storage never got: keep that.
window.addEventListener('storage', (e) => {
  if (e.key !== KEY || unsaved) return;
  current = read() ?? current;
  seenSet = new Set(current.seen);
  for (const listen of listeners) listen(current);
});

export const getProgress = () => current;
export const hasSeen = (id: string) => seenSet.has(id);

export function useProgress(): PuzzleProgress {
  const [p, setP] = useState(current);
  useEffect(() => {
    listeners.add(setP);
    // Another page may have changed it between the first render and now.
    setP(current);
    return () => void listeners.delete(setP);
  }, []);
  return p;
}

export function updateProgress(patch: Partial<PuzzleProgress> | ((p: PuzzleProgress) => Partial<PuzzleProgress>)) {
  const base = latest();
  save({ ...base, ...(typeof patch === 'function' ? patch(base) : patch) });
}

export function markSeen(id: string) {
  if (seenSet.has(id)) return;
  updateProgress((p) => ({ seen: [...p.seen, id].slice(-SEEN) }));
}

/**
 * Starts (or restarts) the rating from a chosen level. The deviation starts wide, but not Glicko's full 350:
 * the level is a real hint, and a first puzzle shouldn't swing it by 200.
 */
export const startAt = (rating: number) => updateProgress({ rating, rd: 250, vol: 0.06 });

/**
 * Scores one rated puzzle and returns how far the rating moved. The puzzle is the "opponent": solving it is a
 * win against its rating, failing a loss.
 */
export function rate(puzzle: { id: string; rating: number; rd: number }, ok: boolean): number {
  const p = latest();
  if (p.rating == null) return 0;
  const next = glicko2({ rating: p.rating, rd: p.rd, vol: p.vol }, { rating: puzzle.rating, rd: puzzle.rd }, ok ? 1 : 0);
  const delta = Math.round(next.rating) - Math.round(p.rating);
  save({
    ...p,
    ...next,
    played: p.played + 1,
    solved: p.solved + (ok ? 1 : 0),
    recent: [...p.recent, { id: puzzle.id, ok, rating: puzzle.rating, delta }].slice(-30),
    seen: p.seen.includes(puzzle.id) ? p.seen : [...p.seen, puzzle.id].slice(-SEEN),
  });
  return delta;
}

// ---------------------------------------------------------------- Glicko-2 (Glickman, 2012), one game per period

const SCALE = 173.7178;
/** How fast volatility may change; lichess uses 0.75 for puzzles. */
const TAU = 0.75;
/** Never this sure of a rating, so it keeps moving enough to feel each puzzle. */
const MIN_RD = 60;

export function glicko2(me: { rating: number; rd: number; vol: number }, them: { rating: number; rd: number }, score: 0 | 1) {
  const mu = (me.rating - 1500) / SCALE;
  const phi = me.rd / SCALE;
  const muJ = (them.rating - 1500) / SCALE;
  const phiJ = them.rd / SCALE;
  const g = 1 / Math.sqrt(1 + (3 * phiJ * phiJ) / (Math.PI * Math.PI));
  const e = 1 / (1 + Math.exp(-g * (mu - muJ)));
  const v = 1 / (g * g * e * (1 - e));
  const delta = v * g * (score - e);

  // The new volatility: the root of f, found with the Illinois method as the paper describes.
  const a = Math.log(me.vol * me.vol);
  const f = (x: number) => {
    const ex = Math.exp(x);
    return (ex * (delta * delta - phi * phi - v - ex)) / (2 * (phi * phi + v + ex) ** 2) - (x - a) / (TAU * TAU);
  };
  let lo = a;
  let hi: number;
  if (delta * delta > phi * phi + v) hi = Math.log(delta * delta - phi * phi - v);
  else {
    let k = 1;
    while (f(a - k * TAU) < 0) k++;
    hi = a - k * TAU;
  }
  let fLo = f(lo);
  let fHi = f(hi);
  for (let i = 0; i < 100 && Math.abs(hi - lo) > 1e-6; i++) {
    const c = lo + ((lo - hi) * fLo) / (fHi - fLo);
    const fC = f(c);
    if (fC * fHi <= 0) {
      lo = hi;
      fLo = fHi;
    } else fLo /= 2;
    hi = c;
    fHi = fC;
  }
  const vol = Math.exp(lo / 2);
  const phiStar = Math.sqrt(phi * phi + vol * vol);
  const phiNew = 1 / Math.sqrt(1 / (phiStar * phiStar) + 1 / v);
  const muNew = mu + phiNew * phiNew * g * (score - e);
  return { rating: Math.min(3500, Math.max(100, 1500 + SCALE * muNew)), rd: Math.min(350, Math.max(MIN_RD, SCALE * phiNew)), vol: Math.min(0.2, vol) };
}
