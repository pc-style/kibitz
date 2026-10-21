import { defineSchema, defineTable } from 'convex/server';
import { v } from 'convex/values';

/** A player in a room. The token is a random secret kept in the player's browser; it never leaves the server. */
export const seat = v.object({
  token: v.string(),
  name: v.string(),
  /** Last heartbeat from this player's open tab, for the online dot. Not counted as activity. */
  seenAt: v.number(),
});

export const color = v.union(v.literal('white'), v.literal('black'));

export const status = v.union(v.literal('waiting'), v.literal('playing'), v.literal('over'), v.literal('closed'));

export default defineSchema({
  rooms: defineTable({
    /** The short code in the share link. */
    code: v.string(),
    /** Time control id from timeControls.ts ('10+0', 'none', ...). */
    clock: v.string(),
    white: v.optional(seat),
    black: v.optional(seat),
    status,
    /** Counts games in this room; a rematch starts the next one. */
    game: v.number(),
    /** The current game's moves in UCI, from the standard start. */
    moves: v.array(v.string()),
    fen: v.string(),
    result: v.optional(v.string()),
    reason: v.optional(v.string()),
    /** Time left for each side when its clock last stopped. */
    whiteMs: v.number(),
    blackMs: v.number(),
    /** When the side to move's clock started (server time). */
    turnStartedAt: v.number(),
    drawOffer: v.optional(color),
    rematch: v.optional(color),
    /** Any player action. Rooms close 15 minutes after the last one. */
    lastActivity: v.number(),
  })
    .index('by_code', ['code'])
    .index('by_status_activity', ['status', 'lastActivity']),
});
