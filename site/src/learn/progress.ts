import { useEffect, useState } from 'preact/hooks';

/** Best stars per lesson id (1-3), kept in this browser only. */
export type Stars = Record<string, number>;

const KEY = 'kibitz:learn';

function load(): Stars {
  try {
    return JSON.parse(localStorage.getItem(KEY) ?? '{}') as Stars;
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
