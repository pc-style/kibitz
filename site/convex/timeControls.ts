/** Time modes for games between friends. Shared by the server (clocks) and the site (pickers, clock faces). */
export const TIME_CONTROLS = [
  { id: '1+0', label: 'Bullet', minutes: 1, increment: 0 },
  { id: '3+2', label: 'Blitz', minutes: 3, increment: 2 },
  { id: '5+0', label: 'Blitz', minutes: 5, increment: 0 },
  { id: '10+0', label: 'Rapid', minutes: 10, increment: 0 },
  { id: '15+10', label: 'Rapid', minutes: 15, increment: 10 },
  { id: 'none', label: 'No clock', minutes: 0, increment: 0 },
] as const;

export type TimeControlId = (typeof TIME_CONTROLS)[number]['id'];

export const timeControl = (id: string) => TIME_CONTROLS.find((t) => t.id === id);

/** Starting time in ms, or 0 for games without a clock. */
export const initialMs = (id: string) => (timeControl(id)?.minutes ?? 0) * 60_000;

export const incrementMs = (id: string) => (timeControl(id)?.increment ?? 0) * 1000;

/** Rooms close after this long without a player action. */
export const IDLE_MS = 15 * 60_000;
