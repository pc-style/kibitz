/**
 * Who you are when playing a friend: a random token that marks your seat in a room, and the name you
 * chose. Kept in this browser only; there are no accounts.
 */
export interface Player {
  token: string;
  name: string;
}

const KEY = 'kibitz:player';

function randomToken(): string {
  if (crypto.randomUUID) return crypto.randomUUID();
  return Array.from(crypto.getRandomValues(new Uint8Array(16)), (b) => b.toString(16).padStart(2, '0')).join('');
}

let current: Player | null = null;

export function player(): Player {
  if (current) return current;
  try {
    const saved = JSON.parse(localStorage.getItem(KEY) ?? 'null') as Partial<Player> | null;
    if (typeof saved?.token === 'string' && saved.token.length >= 16)
      return (current = { token: saved.token, name: typeof saved.name === 'string' ? saved.name : '' });
  } catch {
    // Unreadable or blocked storage: a fresh identity for this visit.
  }
  current = { token: randomToken(), name: '' };
  save();
  return current;
}

export function setPlayerName(name: string) {
  current = { ...player(), name: name.trim().slice(0, 20) };
  save();
}

function save() {
  try {
    localStorage.setItem(KEY, JSON.stringify(current));
  } catch {
    // Private mode: the seat still works until the tab closes.
  }
}

/** Online play needs the Convex URL baked in at build time. */
export const onlineAvailable = !!import.meta.env.VITE_CONVEX_URL;

export const roomHash = (code: string) => `#/play/${code}`;

export const roomLink = (code: string) => `${location.origin}${location.pathname}${roomHash(code)}`;
