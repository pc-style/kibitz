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
    const stop = c.subscribeToConnectionState((s) => {
      if (s.hasEverConnected) setConnected(s.isWebSocketConnected);
    });
    return () => {
      clearTimeout(timer);
      stop();
    };
  }, []);
  return connected;
}

let offset = 0;
let synced: Promise<void> | null = null;

/**
 * Measures how far this device's clock is from the server's, once per visit. The first call also waits for
 * the socket to connect, so it takes a few round trips and trusts the fastest.
 */
export function syncServerTime(): Promise<void> {
  return (synced ??= (async () => {
    let fastest = Infinity;
    for (let i = 0; i < 3; i++) {
      const sent = Date.now();
      const server = await convex().mutation(api.rooms.now, {});
      const trip = Date.now() - sent;
      if (trip < fastest) {
        fastest = trip;
        offset = server - (sent + trip / 2);
      }
    }
  })().catch(() => {
    synced = null;
  }));
}

export const serverNow = () => Date.now() + offset;
