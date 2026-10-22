import { Chess } from 'chess.js';
import { useEffect, useRef } from 'preact/hooks';
import { getSettings, type SoundSet } from './settings';

/** Every sound a set has. scripts/make-sounds.py synthesizes them; see there for what each one is. */
export type SoundName =
  | 'move'
  | 'capture'
  | 'check'
  | 'castle'
  | 'promote'
  | 'start'
  | 'win'
  | 'lose'
  | 'draw'
  | 'notify'
  | 'lowtime'
  | 'correct'
  | 'wrong'
  | 'star';

// src/sounds/<set>/<sound>[-<take>].mp3, bundled under hashed names so a regenerated sound is never stale.
const FILES = import.meta.glob<string>('./sounds/*/*.mp3', { eager: true, query: '?url', import: 'default' });
const LIBRARY: Record<string, Record<string, string[]>> = {};
for (const [path, url] of Object.entries(FILES)) {
  const [, set, name] = /\/sounds\/(\w+)\/([a-z]+)(?:-\d+)?\.mp3$/.exec(path) ?? [];
  if (set && name) ((LIBRARY[set] ??= {})[name] ??= []).push(url);
}

interface Clip {
  buffer: AudioBuffer;
  /** Where the sound starts: MP3 decoders can put a few milliseconds of silence first. */
  offset: number;
}
type Bank = Map<string, Clip[]>;

let ctx: AudioContext | null = null;
let output: GainNode | null = null;
let woke = 0;
const loading = new Map<SoundSet, Promise<Bank>>();
const ready = new Map<SoundSet, Bank>();

async function decode(url: string): Promise<Clip> {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`${url}: ${response.status}`);
  const buffer = await ctx!.decodeAudioData(await response.arrayBuffer());
  const data = buffer.getChannelData(0);
  let first = 0;
  while (first < data.length && Math.abs(data[first]) < 0.003) first++;
  return { buffer, offset: Math.max(0, first - 32) / buffer.sampleRate };
}

/** Downloads and decodes a set once; a failed download is tried again the next time it's needed. */
function bank(set: SoundSet): Promise<Bank> {
  let pending = loading.get(set);
  if (!pending) {
    pending = Promise.all(Object.entries(LIBRARY[set] ?? {}).map(async ([name, urls]) => [name, await Promise.all(urls.map(decode))] as const)).then(
      (entries) => {
        const loaded = new Map(entries);
        ready.set(set, loaded);
        return loaded;
      },
    );
    pending.catch(() => loading.delete(set));
    loading.set(set, pending);
  }
  return pending;
}

/**
 * Browsers only let a page make sound after a click, tap or key press, so the first one anywhere on the site
 * starts the audio and fetches the chosen set (about 100 kB), well before the first move needs it.
 */
function wake() {
  const { sound, soundSet } = getSettings();
  if (!sound || typeof AudioContext === 'undefined') return;
  if (!ctx) {
    ctx = new AudioContext({ latencyHint: 'interactive' });
    output = ctx.createGain();
    output.connect(ctx.destination);
  }
  if (ctx.state !== 'running') {
    woke = performance.now();
    ctx.resume().catch(() => {});
  }
  bank(soundSet).catch(() => {});
}
// Touches count as permission only when they end, so touchend and pointerup are here too.
for (const type of ['pointerdown', 'pointerup', 'touchend', 'keydown'] as const) addEventListener(type, wake, { capture: true, passive: true });

const lastTake = new Map<string, number>();
const voices: AudioBufferSourceNode[] = [];

function start(sounds: Bank, name: SoundName, pitch: number, delay: number) {
  const clips = sounds.get(name);
  if (!ctx || !output || !clips?.length) return;
  // A different take from last time, so a run of moves sounds like hands, not a machine.
  let take = Math.floor(Math.random() * clips.length);
  if (clips.length > 1 && take === lastTake.get(name)) take = (take + 1) % clips.length;
  lastTake.set(name, take);
  const source = ctx.createBufferSource();
  source.buffer = clips[take].buffer;
  source.playbackRate.value = 2 ** (pitch / 12);
  source.connect(output);
  source.start(ctx.currentTime + delay, clips[take].offset);
  source.onended = () => {
    const i = voices.indexOf(source);
    if (i >= 0) voices.splice(i, 1);
  };
  voices.push(source);
  // Holding an arrow key through a game would pile up dozens of knocks; only the latest few ring on.
  while (voices.length > 6) voices.shift()!.stop();
}

/**
 * Plays a sound from the chosen set, if sound is on. `pitch` raises it by semitones; `delay` is in seconds.
 * Before the first click or key press browsers allow no sound, so nothing plays then.
 */
export function play(name: SoundName, { pitch = 0, delay = 0 }: { pitch?: number; delay?: number } = {}) {
  const { sound, soundSet } = getSettings();
  if (!sound || !ctx) return;
  // Suspended for a while (a phone locked and unlocked) means sounds would pile up and burst out on the next
  // tap; just after a tap means it is starting, and the sound will play the moment it has.
  if (ctx.state !== 'running' && performance.now() - woke > 500) return;
  const sounds = ready.get(soundSet);
  if (sounds) return start(sounds, name, pitch, delay);
  const asked = performance.now();
  // Still downloading: play it if it arrives soon enough to belong to what just happened.
  bank(soundSet).then(
    (loaded) => performance.now() - asked < 400 && start(loaded, name, pitch, delay),
    () => {},
  );
}

/** A taste of a set, for the settings panel: a move, a capture and a check. */
export function preview(set: SoundSet) {
  wake();
  bank(set).then(
    (sounds) => {
      if (getSettings().soundSet !== set) return;
      start(sounds, 'move', 0, 0);
      start(sounds, 'capture', 0, 0.38);
      start(sounds, 'check', 0, 0.76);
    },
    () => {},
  );
}

/** Steps up a major pentatonic scale, for stars collected one after another. */
export const STAR_STEPS = [0, 2, 4, 7, 9, 12, 14, 16];

/**
 * Plays a sound when `key` changes, but never for its first value: arriving at a finished game shouldn't play
 * its ending, only seeing it end should. `pick` turns the new key into the sound, or nothing.
 */
export function useCue<T>(key: T, pick: (key: T) => SoundName | null | undefined | false) {
  const seen = useRef(key);
  useEffect(() => {
    if (Object.is(seen.current, key)) return;
    seen.current = key;
    const name = pick(key);
    if (name) play(name);
  }, [key]);
}

/** The sound for a finished game, from where you sat: watchers and draws (and aborted games) get the neutral one. */
export function endSound(result: string | null | undefined, you: 'white' | 'black' | null): SoundName {
  const winner = result === '1-0' ? 'white' : result === '0-1' ? 'black' : null;
  return !winner || !you ? 'draw' : winner === you ? 'win' : 'lose';
}

// ---------------------------------------------------------------- what a move sounds like

function squares(fen: string): string[] {
  return fen
    .split(' ')[0]
    .split('/')
    .flatMap((row) => [...row].flatMap((c) => (/\d/.test(c) ? Array<string>(Number(c)).fill('') : [c])));
}

/** a8 is 0, h1 is 63, as in a FEN. */
const at = (square: string) => (56 - (square.charCodeAt(1) - 49) * 8) + (square.charCodeAt(0) - 97);

/**
 * The sound a board change makes: the move's sound if `after` is exactly `before` with `lastMove` played, and
 * null for anything else (a game loaded, a jump through the moves, stepping back), which should be quiet.
 */
export function moveSound(before: string, after: string, lastMove?: readonly string[]): SoundName | null {
  if (!lastMove || lastMove.length < 2 || before === after) return null;
  const was = squares(before);
  const now = squares(after);
  const from = at(lastMove[0]);
  const to = at(lastMove[1]);
  const piece = was[from];
  if (was.length !== 64 || now.length !== 64 || !piece) return null;
  const kind = piece.toLowerCase();
  const expected = [...was];
  expected[from] = '';
  let captured = !!was[to];
  const castled = kind === 'k' && Math.abs((from % 8) - (to % 8)) === 2;
  if (castled) {
    const rook = to % 8 > from % 8 ? from - (from % 8) + 7 : from - (from % 8);
    expected[(from + to) / 2] = expected[rook];
    expected[rook] = '';
  }
  if (kind === 'p' && from % 8 !== to % 8 && !was[to]) {
    expected[from - (from % 8) + (to % 8)] = '';
    captured = true;
  }
  expected[to] = piece;
  const promoted = kind === 'p' && (to < 8 || to >= 56);
  // The board shows whichever piece the pawn became.
  if (promoted && now[to] && now[to] !== piece && (now[to] === now[to].toUpperCase()) === (piece === piece.toUpperCase())) expected[to] = now[to];
  if (expected.some((p, i) => p !== now[i])) return null;
  let check = false;
  try {
    // Practice boards can have no kings, which chess.js only takes unvalidated.
    check = new Chess(after, { skipValidation: true }).inCheck();
  } catch {
    // An odd position just doesn't get the check sound.
  }
  return check ? 'check' : promoted ? 'promote' : castled ? 'castle' : captured ? 'capture' : 'move';
}
