import { ConvexClient } from 'convex/browser';
import type { FunctionReturnType } from 'convex/server';
import { ConvexError } from 'convex/values';
import { useEffect, useState } from 'preact/hooks';
import { api } from '../../convex/_generated/api';

/** The live connection to the rooms backend. This module is only loaded on pages that play online. */

export type RoomView = NonNullable<FunctionReturnType<typeof api.rooms.get>>;

let client: ConvexClient | null = null;

function convex(): ConvexClient {
  const url = import.meta.env.VITE_CONVEX_URL as string | undefined;
  if (!url) throw new Error('Online play is not set up on this copy of Kibitz.');
  return (client ??= new ConvexClient(url));
}

/** The words of a server refusal ("It's not your move."), or a generic line for network failures. */
export function errorText(err: unknown): string {
  if (err instanceof ConvexError && typeof err.data === 'string') return err.data;
  return 'Could not reach the game server. Check your connection and try again.';
}

export const rooms = {
  create: (args: { token: string; name: string; clock: string; color: 'white' | 'black' | 'random' }) => convex().mutation(api.rooms.create, args),
  join: (args: { code: string; token: string; name: string }) => convex().mutation(api.rooms.join, args),
  setName: (args: { code: string; token: string; name: string }) => convex().mutation(api.rooms.setName, args),
  setClock: (args: { code: string; token: string; clock: string }) => convex().mutation(api.rooms.setClock, args),
  move: (args: { code: string; token: string; uci: string; ply: number }) => convex().mutation(api.rooms.move, args),
  resign: (args: { code: string; token: string }) => convex().mutation(api.rooms.resign, args),
  abort: (args: { code: string; token: string }) => convex().mutation(api.rooms.abort, args),
  offerDraw: (args: { code: string; token: string }) => convex().mutation(api.rooms.offerDraw, args),
  declineDraw: (args: { code: string; token: string }) => convex().mutation(api.rooms.declineDraw, args),
  rematch: (args: { code: string; token: string }) => convex().mutation(api.rooms.rematch, args),
  heartbeat: (args: { code: string; token: string }) => convex().mutation(api.rooms.heartbeat, args),
};

/** The room as the server sees it, live. undefined while loading, null if there is no such room. */
export function useRoom(code: string, token: string): { room: RoomView | null | undefined; error?: string } {
  const [room, setRoom] = useState<RoomView | null | undefined>(undefined);
  const [error, setError] = useState<string>();
  useEffect(() => {
    try {
      return convex().onUpdate(
        api.rooms.get,
        { code, token },
        (r) => {
          setRoom(r);
          setError(undefined);
        },
        (e) => setError(errorText(e)),
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, [code, token]);
  return { room, error };
}

/** False while the socket is down, so the page can say it's reconnecting instead of looking frozen. */
export function useConnected(): boolean {
  const [connected, setConnected] = useState(true);
  useEffect(() => {
    let c: ConvexClient;
    try {
      c = convex();
    } catch {
      return;
    }
    // Give the first connection a moment before calling it lost.
    const timer = setTimeout(() => setConnected(c.connectionState().isWebSocketConnected), 4000);
    let was = true;
    const stop = c.subscribeToConnectionState((s) => {
      if (!s.hasEverConnected) return;
      setConnected(s.isWebSocketConnected);
      if (s.isWebSocketConnected && !was) void syncServerTime(true);
      was = s.isWebSocketConnected;
    });
    return () => {
      clearTimeout(timer);
      stop();
    };
  }, []);
  return connected;
}

// Server time is a reading from the server plus time elapsed on the monotonic clock, so changing the
// device's clock mid-game doesn't move it. Until the first reading, the device clock stands in.
let anchor = { server: Date.now(), at: performance.now(), wall: Date.now() };
let synced: Promise<void> | null = null;
let watching = false;

/**
 * Some systems pause the monotonic clock while the computer sleeps, which would leave clocks behind with
 * the tab still visible and the socket still up. When it and the wall clock drift apart, read the server again.
 */
function watchForDrift() {
  if (watching) return;
  watching = true;
  let reading = false;
  setInterval(() => {
    const drift = Date.now() - anchor.wall - (performance.now() - anchor.at);
    if (reading || Math.abs(drift) < 1500) return;
    reading = true;
    void syncServerTime(true).finally(() => {
      anchor.wall = Date.now() - (performance.now() - anchor.at);
      reading = false;
    });
  }, 2000);
}

/**
 * Reads the server's clock. The first call also waits for the socket to connect, so it takes a few round
 * trips and trusts the fastest. Pass `again` to resample, e.g. after reconnecting or a sleeping tab.
 */
export function syncServerTime(again = false): Promise<void> {
  watchForDrift();
  if (again) synced = null;
  return (synced ??= (async () => {
    let fastest = Infinity;
    for (let i = 0; i < 3; i++) {
      const sent = performance.now();
      const server = await convex().mutation(api.rooms.now, {});
      const trip = performance.now() - sent;
      if (trip < fastest) {
        fastest = trip;
        anchor = { server: server + trip / 2, at: sent + trip, wall: Date.now() };
      }
    }
  })().catch(() => {
    synced = null;
  }));
}

export const serverNow = () => anchor.server + (performance.now() - anchor.at);
