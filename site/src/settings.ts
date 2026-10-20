import { useEffect, useState } from 'preact/hooks';

export const THEMES = [
  { id: 'classic', label: 'Classic' },
  { id: 'walnut', label: 'Walnut' },
  { id: 'midnight', label: 'Midnight' },
  { id: 'marine', label: 'Marine' },
  { id: 'coral', label: 'Coral' },
  { id: 'graphite', label: 'Graphite' },
  { id: 'paper', label: 'Paper' },
  { id: 'newsprint', label: 'Newsprint' },
] as const;
export type Theme = (typeof THEMES)[number]['id'];

/** Piece sets bundled in public/pieces (see scripts/copy-pieces.mjs for licensing). */
export const PIECE_SETS = [
  { id: 'cburnett', label: 'Standard' },
  { id: 'merida', label: 'Merida' },
  { id: 'chessnut', label: 'Chessnut' },
  { id: 'fantasy', label: 'Fantasy' },
  { id: 'spatial', label: 'Spatial' },
  { id: 'celtic', label: 'Celtic' },
] as const;
export type PieceSet = (typeof PIECE_SETS)[number]['id'];

export const DEPTHS = [
  { depth: 12, label: 'Quick' },
  { depth: 16, label: 'Standard' },
  { depth: 20, label: 'Deep' },
] as const;

export interface Settings {
  theme: Theme;
  pieces: PieceSet;
  coordinates: boolean;
  evalBar: boolean;
  arrows: boolean;
  motion: boolean;
  depth: number;
}

const KEY = 'kibitz:settings';

function load(): Settings {
  // index.html already picked the theme before first paint; start from what it chose.
  const theme = (document.documentElement.dataset.theme as Theme | undefined) ?? 'classic';
  const defaults: Settings = { theme, pieces: 'cburnett', coordinates: true, evalBar: true, arrows: true, motion: true, depth: 16 };
  try {
    const saved = JSON.parse(localStorage.getItem(KEY) ?? '{}') as Partial<Settings>;
    const legacyDepth = Number(localStorage.getItem('kibitz:depth')) || undefined;
    return { ...defaults, depth: legacyDepth ?? defaults.depth, ...saved, theme };
  } catch {
    return defaults;
  }
}

let current: Settings = load();
const listeners = new Set<(s: Settings) => void>();

function apply(s: Settings) {
  const root = document.documentElement;
  root.dataset.theme = s.theme;
  root.dataset.pieces = s.pieces;
  root.dataset.motion = s.motion ? 'on' : 'off';
}
apply(current);

export const getSettings = () => current;

export function updateSettings(patch: Partial<Settings>) {
  current = { ...current, ...patch };
  apply(current);
  try {
    localStorage.setItem(KEY, JSON.stringify(current));
  } catch {
    // Private mode: settings still apply for this visit.
  }
  for (const listen of listeners) listen(current);
}

export function useSettings(): Settings {
  const [s, setS] = useState(current);
  useEffect(() => {
    listeners.add(setS);
    return () => void listeners.delete(setS);
  }, []);
  return s;
}

/** True when motion should be skipped: the OS asks for less, or the user switched animations off. */
export const reducedMotion = () => !current.motion || matchMedia('(prefers-reduced-motion: reduce)').matches;
