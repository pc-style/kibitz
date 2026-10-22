import { useEffect, useState } from 'preact/hooks';

/** Best stars per lesson id (1-3), kept in this browser only. */
export type Stars = Record<string, number>;

const KEY = 'kibitz:learn';

function load(): Stars {
  try {
    const saved: unknown = JSON.parse(localStorage.getItem(KEY) ?? '{}');
    if (!saved || typeof saved !== 'object' || Array.isArray(saved)) return {};
    // Keep only sane entries, so a damaged save can't break the course map or Home.
    return Object.fromEntries(Object.entries(saved).filter(([, n]) => n === 1 || n === 2 || n === 3)) as Stars;
  } catch {
    return {};
  }
}

let current = load();
const listeners = new Set<(s: Stars) => void>();

/** Records a finished lesson, keeping the best result. */
export function saveStars(id: string, stars: number) {
  if ((current[id] ?? 0) >= stars) return;
  current = { ...current, [id]: stars };
  try {
    localStorage.setItem(KEY, JSON.stringify(current));
  } catch {
    // Private mode: progress lasts for this visit.
  }
  for (const listen of listeners) listen(current);
}

export function useStars(): Stars {
  const [s, setS] = useState(current);
  useEffect(() => {
    listeners.add(setS);
    return () => void listeners.delete(setS);
  }, []);
  return s;
}
