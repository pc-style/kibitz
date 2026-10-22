import { Chess } from 'chess.js';
import { ConvexError, v } from 'convex/values';
import { internal } from './_generated/api';
import type { Doc } from './_generated/dataModel';
import { internalMutation, mutation, query, type MutationCtx, type QueryCtx } from './_generated/server';
import { IDLE_MS, incrementMs, initialMs, timeControl } from './timeControls';

/**
 * Rooms for playing a friend over a link. No accounts: each browser keeps a random token, and whoever
 * holds a seat's token plays that seat. The server checks every move and runs the clocks.
 */

type Color = 'white' | 'black';
type Room = Doc<'rooms'>;

const START = new Chess().fen();
const CODE_CHARS = '23456789abcdefghjkmnpqrstuvwxyz';
const MAX_WAITING = 500;
const MAX_WAITING_EACH = 5;
/** Closed rooms stay readable for a day ("this room closed"), then go. */
const DELETE_AFTER_MS = 24 * 60 * 60_000;

const other = (c: Color): Color => (c === 'white' ? 'black' : 'white');
const msKey = (c: Color) => (c === 'white' ? 'whiteMs' : 'blackMs');
const turnOf = (room: Room): Color => (room.moves.length % 2 === 0 ? 'white' : 'black');

function cleanName(name: string): string {
  return name.replace(/\s+/g, ' ').trim().slice(0, 20) || 'Player';
}

function checkToken(token: string) {
  if (token.length < 16 || token.length > 64) throw new ConvexError('This browser has no valid player id. Reload the page.');
}

const seatOf = (room: Room, token?: string): Color | null =>
  !token ? null : room.white?.token === token ? 'white' : room.black?.token === token ? 'black' : null;

async function findRoom(ctx: QueryCtx, code: string) {
  return ctx.db
    .query('rooms')
    .withIndex('by_code', (q) => q.eq('code', code))
    .unique();
}

/** The room and the caller's seat, for actions only a seated player may take. */
async function playerRoom(ctx: MutationCtx, code: string, token: string): Promise<{ room: Room; me: Color }> {
  checkToken(token);
  const room = await findRoom(ctx, code);
  if (!room) throw new ConvexError('This room does not exist.');
  if (room.status === 'closed') throw new ConvexError('This room has closed.');
  const me = seatOf(room, token);
  if (!me) throw new ConvexError('You are watching this game, not playing in it.');
  return { room, me };
}

function replay(moves: string[]): Chess {
  const chess = new Chess();
  for (const m of moves) chess.move({ from: m.slice(0, 2), to: m.slice(2, 4), promotion: m[4] });
  return chess;
}

/** How the board itself ended the game, if it did. Repetition and the 50-move rule draw automatically. */
function ending(chess: Chess): { result: string; reason: string } | null {
  if (chess.isCheckmate()) return { result: chess.turn() === 'w' ? '0-1' : '1-0', reason: 'checkmate' };
  if (chess.isStalemate()) return { result: '1/2-1/2', reason: 'stalemate' };
  if (chess.isInsufficientMaterial()) return { result: '1/2-1/2', reason: 'insufficient' };
  if (chess.isThreefoldRepetition()) return { result: '1/2-1/2', reason: 'repetition' };
  if (chess.isDrawByFiftyMoves()) return { result: '1/2-1/2', reason: 'fifty' };
  return null;
}

/**
 * Whether `side` has mating material, which decides if the opponent running out of time loses or draws.
 * Lichess's rules: a lone king can't mate; a lone knight mates only against a rook, bishop, knight or pawn
 * (something to box the king in that can't also block or capture); bishops all on one square color mate
 * only against a knight, a pawn or a bishop of the other color.
 */
function canMate(chess: Chess, side: Color): boolean {
  const pieces = chess
    .board()
    .flat()
    .filter((p): p is NonNullable<typeof p> => p !== null && p.type !== 'k');
  const mine = pieces.filter((p) => p.color === side[0]);
  const theirs = pieces.filter((p) => p.color !== side[0]);
  if (mine.some((p) => p.type === 'p' || p.type === 'r' || p.type === 'q')) return true;
  const knights = mine.filter((p) => p.type === 'n').length;
  const bishops = mine.filter((p) => p.type === 'b');
  if (!knights && !bishops.length) return false;
  if (knights && bishops.length) return true;
  if (knights) return knights >= 2 || theirs.some((p) => p.type !== 'q');
  const shade = (sq: string) => (sq.charCodeAt(0) + Number(sq[1])) % 2;
  const mineShade = new Set(bishops.map((p) => shade(p.square)));
  if (mineShade.size > 1) return true;
  return theirs.some((p) => p.type === 'n' || p.type === 'p' || (p.type === 'b' && !mineShade.has(shade(p.square))));
}

const winFor = (c: Color) => (c === 'white' ? '1-0' : '0-1');

/** Clocks run once both sides have made a move, like lichess. */
const clockRunning = (room: Room) => room.clock !== 'none' && room.status === 'playing' && room.moves.length >= 2;

function timeoutPatch(room: Room, flagged: Color, now: number): Partial<Room> {
  const draw = !canMate(replay(room.moves), other(flagged));
  return {
    [msKey(flagged)]: 0,
    status: 'over',
    result: draw ? '1/2-1/2' : winFor(other(flagged)),
    reason: draw ? 'timeout-draw' : 'timeout',
    drawOffer: undefined,
    // Running out of time counts as activity, so the players get the full 15 minutes to ask for a rematch.
    lastActivity: now,
  };
}

/** The side to move's time left right now, or null when no clock is running. */
const timeLeft = (room: Room, now: number) => (clockRunning(room) ? room[msKey(turnOf(room))] - (now - room.turnStartedAt) : null);

/**
 * Before anything ends a game (a move, resignation, a draw), checks whether the side to move already ran
 * out of time; the scheduled flag check may simply not have run yet. Returns the timeout to apply, if any.
 */
function flagFallen(room: Room, now: number): Partial<Room> | null {
  const left = timeLeft(room, now);
  return left !== null && left <= 0 ? timeoutPatch(room, turnOf(room), now) : null;
}

/** Stops the running clock where it stands, for games that end by resignation or agreement. */
function stopClock(room: Room, now: number): Partial<Room> {
  const left = timeLeft(room, now);
  return left === null ? {} : { [msKey(turnOf(room))]: left };
}

async function scheduleFlag(ctx: MutationCtx, room: Room, inMs: number) {
  await ctx.scheduler.runAfter(Math.max(0, inMs), internal.rooms.flag, { id: room._id, game: room.game, ply: room.moves.length });
}

// ---------------------------------------------------------------- reading

/** Everything a page needs to draw the room. Tokens stay on the server; `you` says which seat, if any, is the caller's. */
export const get = query({
  args: { code: v.string(), token: v.optional(v.string()) },
  handler: async (ctx, { code, token }) => {
    const room = await findRoom(ctx, code);
    if (!room) return null;
    const seat = (s: Room['white']) => (s ? { name: s.name, seenAt: s.seenAt } : null);
    return {
      code: room.code,
      clock: room.clock,
      status: room.status,
      game: room.game,
      moves: room.moves,
      fen: room.fen,
      result: room.result ?? null,
      reason: room.reason ?? null,
      whiteMs: room.whiteMs,
      blackMs: room.blackMs,
      turnStartedAt: room.turnStartedAt,
      drawOffer: room.drawOffer ?? null,
      rematch: room.rematch ?? null,
      lastActivity: room.lastActivity,
      white: seat(room.white),
      black: seat(room.black),
      you: seatOf(room, token),
    };
  },
});

/** Server time, so pages can run clocks and the idle countdown without trusting the device's clock. */
export const now = mutation({ args: {}, handler: async () => Date.now() });

// ---------------------------------------------------------------- room setup

export const create = mutation({
  args: { token: v.string(), name: v.string(), clock: v.string(), color: v.union(v.literal('white'), v.literal('black'), v.literal('random')) },
  handler: async (ctx, { token, name, clock, color }) => {
    checkToken(token);
    if (!timeControl(clock)) throw new ConvexError('Unknown time control.');
    // A cheap barrier against scripts filling the database: a few open links per player, and a ceiling for everyone.
    const now = Date.now();
    const recent = await ctx.db
      .query('rooms')
      .withIndex('by_status_activity', (q) => q.eq('status', 'waiting').gt('lastActivity', now - IDLE_MS))
      .take(MAX_WAITING + 1);
    if (recent.length > MAX_WAITING) throw new ConvexError('A lot of new games are being made right now. Try again in a few minutes.');
    if (recent.filter((r) => r.white?.token === token || r.black?.token === token).length >= MAX_WAITING_EACH)
      throw new ConvexError('You already have a few game links waiting for a friend. Send one of those, or wait a few minutes.');
    let code = '';
    do {
      code = Array.from({ length: 8 }, () => CODE_CHARS[Math.floor(Math.random() * CODE_CHARS.length)]).join('');
    } while (await findRoom(ctx, code));
    const side: Color = color === 'random' ? (Math.random() < 0.5 ? 'white' : 'black') : color;
    await ctx.db.insert('rooms', {
      code,
      clock,
      [side]: { token, name: cleanName(name), seenAt: now },
      status: 'waiting',
      game: 1,
      moves: [],
      fen: START,
      whiteMs: initialMs(clock),
      blackMs: initialMs(clock),
      turnStartedAt: now,
      lastActivity: now,
    });
    return code;
  },
});

/** Takes the free seat. Someone already seated just updates their name; a full room can only be watched. */
export const join = mutation({
  args: { code: v.string(), token: v.string(), name: v.string() },
  handler: async (ctx, { code, token, name }) => {
    checkToken(token);
    const room = await findRoom(ctx, code);
    if (!room) throw new ConvexError('This room does not exist.');
    if (room.status === 'closed') throw new ConvexError('This room has closed.');
    const now = Date.now();
    const mine = seatOf(room, token);
    if (mine) {
      await ctx.db.patch(room._id, { [mine]: { ...room[mine]!, name: cleanName(name), seenAt: now }, lastActivity: now });
      return mine;
    }
    const free: Color | null = !room.white ? 'white' : !room.black ? 'black' : null;
    if (!free) throw new ConvexError('This game already has two players. You can still watch.');
    await ctx.db.patch(room._id, {
      [free]: { token, name: cleanName(name), seenAt: now },
      status: 'playing',
      turnStartedAt: now,
      lastActivity: now,
    });
    return free;
  },
});

export const setName = mutation({
  args: { code: v.string(), token: v.string(), name: v.string() },
  handler: async (ctx, { code, token, name }) => {
    const { room, me } = await playerRoom(ctx, code, token);
    await ctx.db.patch(room._id, { [me]: { ...room[me]!, name: cleanName(name) }, lastActivity: Date.now() });
  },
});

/** Either player may change the time mode until the first move of a game. */
export const setClock = mutation({
  args: { code: v.string(), token: v.string(), clock: v.string() },
  handler: async (ctx, { code, token, clock }) => {
    const { room } = await playerRoom(ctx, code, token);
    if (!timeControl(clock)) throw new ConvexError('Unknown time control.');
    if (room.status === 'over' || room.moves.length) throw new ConvexError('The time can only change before the first move.');
    await ctx.db.patch(room._id, { clock, whiteMs: initialMs(clock), blackMs: initialMs(clock), lastActivity: Date.now() });
  },
});

/** Keeps the online dot lit while a player's tab is open. Not activity: an open tab alone doesn't keep a room alive. */
export const heartbeat = mutation({
  args: { code: v.string(), token: v.string() },
  handler: async (ctx, { code, token }) => {
    const room = await findRoom(ctx, code);
    const me = room && room.status !== 'closed' ? seatOf(room, token) : null;
    if (!room || !me) return;
    const now = Date.now();
    if (now - room[me]!.seenAt > 10_000) await ctx.db.patch(room._id, { [me]: { ...room[me]!, seenAt: now } });
  },
});

// ---------------------------------------------------------------- playing

export const move = mutation({
  args: { code: v.string(), token: v.string(), uci: v.string(), ply: v.number() },
  handler: async (ctx, { code, token, uci, ply }) => {
    const { room, me } = await playerRoom(ctx, code, token);
    if (room.status !== 'playing') throw new ConvexError('This game is not in progress.');
    if (ply !== room.moves.length) throw new ConvexError('The board changed. Try that move again.');
    if (turnOf(room) !== me) throw new ConvexError("It's not your move.");
    const now = Date.now();
    const timeout = flagFallen(room, now);
    if (timeout) {
      // The move arrived after the flag fell.
      await ctx.db.patch(room._id, timeout);
      return { timedOut: true };
    }
    const clock: Partial<Room> = {};
    if (room.clock !== 'none') clock[msKey(me)] = (timeLeft(room, now) ?? room[msKey(me)]) + incrementMs(room.clock);
    const chess = replay(room.moves);
    let lan: string;
    try {
      lan = chess.move({ from: uci.slice(0, 2), to: uci.slice(2, 4), promotion: uci[4] }).lan;
    } catch {
      throw new ConvexError('That move is not legal.');
    }
    const end = ending(chess);
    const next: Room = {
      ...room,
      ...clock,
      moves: [...room.moves, lan],
      fen: chess.fen(),
      turnStartedAt: now,
      lastActivity: now,
      // Moving declines the opponent's draw offer; your own offer stands.
      drawOffer: room.drawOffer === me ? me : undefined,
      ...(end ? { status: 'over' as const, ...end, drawOffer: undefined } : {}),
    };
    await ctx.db.replace(room._id, next);
    if (clockRunning(next)) await scheduleFlag(ctx, next, next[msKey(other(me))]);
    return { timedOut: false };
  },
});

/** Runs when the side to move might be out of time. Ends the game, or checks again later if they moved or got more time. */
export const flag = internalMutation({
  args: { id: v.id('rooms'), game: v.number(), ply: v.number() },
  handler: async (ctx, { id, game, ply }) => {
    const room = await ctx.db.get(id);
    if (!room || room.game !== game || room.moves.length !== ply || !clockRunning(room)) return;
    const now = Date.now();
    const left = timeLeft(room, now)!;
    if (left > 0) return scheduleFlag(ctx, room, left);
    await ctx.db.patch(room._id, timeoutPatch(room, turnOf(room), now));
  },
});

export const resign = mutation({
  args: { code: v.string(), token: v.string() },
  handler: async (ctx, { code, token }) => {
    const { room, me } = await playerRoom(ctx, code, token);
    if (room.status !== 'playing') throw new ConvexError('This game is not in progress.');
    const now = Date.now();
    await ctx.db.patch(
      room._id,
      flagFallen(room, now) ?? { ...stopClock(room, now), status: 'over', result: winFor(other(me)), reason: 'resignation', drawOffer: undefined, lastActivity: now },
    );
  },
});

/** Before both sides have moved, either player can call the game off without a result. */
export const abort = mutation({
  args: { code: v.string(), token: v.string() },
  handler: async (ctx, { code, token }) => {
    const { room } = await playerRoom(ctx, code, token);
    if (room.status !== 'playing' || room.moves.length >= 2) throw new ConvexError('This game can no longer be aborted.');
    await ctx.db.patch(room._id, { status: 'over', result: '*', reason: 'aborted', drawOffer: undefined, lastActivity: Date.now() });
  },
});

/** Offers a draw, or accepts the opponent's standing offer. */
export const offerDraw = mutation({
  args: { code: v.string(), token: v.string() },
  handler: async (ctx, { code, token }) => {
    const { room, me } = await playerRoom(ctx, code, token);
    if (room.status !== 'playing') throw new ConvexError('This game is not in progress.');
    const now = Date.now();
    const timeout = flagFallen(room, now);
    if (timeout) {
      await ctx.db.patch(room._id, timeout);
    } else if (room.drawOffer === other(me)) {
      await ctx.db.patch(room._id, { ...stopClock(room, now), status: 'over', result: '1/2-1/2', reason: 'agreement', drawOffer: undefined, lastActivity: now });
    } else {
      await ctx.db.patch(room._id, { drawOffer: me, lastActivity: now });
    }
  },
});

export const declineDraw = mutation({
  args: { code: v.string(), token: v.string() },
  handler: async (ctx, { code, token }) => {
    const { room, me } = await playerRoom(ctx, code, token);
    if (room.drawOffer === other(me)) await ctx.db.patch(room._id, { drawOffer: undefined, lastActivity: Date.now() });
  },
});

/** Asks for another game, or starts it when the opponent already asked. Colors swap; the time mode stays. */
export const rematch = mutation({
  args: { code: v.string(), token: v.string() },
  handler: async (ctx, { code, token }) => {
    const { room, me } = await playerRoom(ctx, code, token);
    if (room.status !== 'over') throw new ConvexError('Finish this game first.');
    const now = Date.now();
    if (room.rematch !== other(me)) {
      await ctx.db.patch(room._id, { rematch: me, lastActivity: now });
      return;
    }
    await ctx.db.replace(room._id, {
      code: room.code,
      clock: room.clock,
      white: room.black,
      black: room.white,
      status: 'playing',
      game: room.game + 1,
      moves: [],
      fen: START,
      whiteMs: initialMs(room.clock),
      blackMs: initialMs(room.clock),
      turnStartedAt: now,
      lastActivity: now,
    });
  },
});

// ---------------------------------------------------------------- housekeeping

/** Closes rooms 15 minutes after the last player action and deletes them a day later. Runs every minute (crons.ts). */
export const closeIdle = internalMutation({
  args: { now: v.optional(v.number()) },
  handler: async (ctx, args) => {
    const now = args.now ?? Date.now();
    let closed = 0;
    for (const status of ['waiting', 'playing', 'over'] as const) {
      const idle = await ctx.db
        .query('rooms')
        .withIndex('by_status_activity', (q) => q.eq('status', status).lt('lastActivity', now - IDLE_MS))
        .take(200);
      for (const room of idle) {
        // Someone thinking on a running clock isn't idle: the flag check ends that game when their time runs out.
        if ((timeLeft(room, now) ?? 0) > 0) continue;
        await ctx.db.patch(room._id, { status: 'closed', drawOffer: undefined, rematch: undefined });
        closed++;
      }
    }
    const old = await ctx.db
      .query('rooms')
      .withIndex('by_status_activity', (q) => q.eq('status', 'closed').lt('lastActivity', now - IDLE_MS - DELETE_AFTER_MS))
      .take(200);
    for (const room of old) await ctx.db.delete(room._id);
    if (closed || old.length) console.log(`closed ${closed} idle rooms, deleted ${old.length} old ones`);
  },
});
