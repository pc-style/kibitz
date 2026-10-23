#!/usr/bin/env python3
# /// script
# requires-python = ">=3.10"
# dependencies = []
# ///
"""
Builds the puzzle files the site loads: a curated slice of lichess's puzzle database plus Kibitz's own puzzles.

lichess publishes every puzzle it has (about 6 million, CC0) at https://database.lichess.org/#puzzles. Most are
fine and some are wonderful, so this keeps the well-liked, well-played ones (popularity 85+, 300+ plays, a
settled rating), spread over the rating range and leaning towards the rarer themes so that every theme has
puzzles at every level. Kibitz's own puzzles (scripts/puzzles: mined from games between the site's bots, and
endgames proven with tablebases, then tagged and rated by tag-rate.py) go in whole.

From site/:   pnpm puzzles --lichess /path/to/lichess_db_puzzle.csv.zst --originals scripts/puzzles/originals.jsonl

Writes src/puzzles/data/<n>.json (shards, by a hash of the puzzle id so a link to one puzzle needs one file),
src/puzzles/data/daily-<n>.json (the puzzles of the day, in order), src/puzzles/data/games.json (the bot games
behind Kibitz's own puzzles) and src/puzzles/index.json (counts per theme, and
per source for Kibitz's own, in each shard). Every random choice is seeded, so a rerun writes the same files.
"""

from __future__ import annotations

import argparse
import csv
import heapq
import io
import json
import math
import random
import shutil
import subprocess
import sys
from collections import Counter
from pathlib import Path

SHARDS = 64

# How many puzzles to keep per 100 rating points. Most players live between 800 and 2200, so most puzzles do too;
# the ends get fewer, and below 600 lichess barely has any.
TARGET = {500: 600, 600: 1500, 700: 2000, 2200: 2400, 2300: 2000, 2400: 1600, 2500: 1500, 2600: 600, 2700: 100}
DEFAULT_TARGET = 3000

# Tags that say how long or how lopsided a puzzle is, or where its game came from; they don't make it rarer.
PLAIN = {'short', 'long', 'veryLong', 'oneMove', 'middlegame', 'endgame', 'opening', 'crushing', 'advantage', 'equality', 'master', 'masterVsMaster', 'superGM', 'mate'}

# lichess's first daily puzzles date from 2021; the site's daily puzzle walks the list from this day on.
DAILY_EPOCH = '2026-01-01'
DAILY_FILE = 100


def fnv1a(text: str) -> int:
    """32-bit FNV-1a, the same as src/puzzles/data.ts uses to find a puzzle's shard from its id."""
    h = 0x811C9DC5
    for byte in text.encode():
        h = ((h ^ byte) * 0x01000193) & 0xFFFFFFFF
    return h


def rows(path: Path):
    """The CSV, streamed through zstd: decompressed it's close to a gigabyte."""
    proc = subprocess.Popen(['zstd', '-dc', str(path)], stdout=subprocess.PIPE)
    reader = csv.reader(io.TextIOWrapper(proc.stdout, encoding='utf-8', newline=''))
    next(reader)
    yield from reader
    if proc.wait():
        sys.exit(f'zstd failed on {path}')


def good(rating: int, rd: int, popularity: int, plays: int, moves: list[str]) -> bool:
    # Up to five moves of your own: longer lines are more slog than puzzle.
    return popularity >= 85 and plays >= 300 and rd <= 80 and len(moves) <= 10 and rating >= 400


def pick_lichess(path: Path, seed: int) -> tuple[list[list], list[list]]:
    # First pass: how common each theme is among the puzzles worth keeping.
    themes: Counter[str] = Counter()
    for pid, fen, moves, rating, rd, pop, plays, tags, url, _, daily in rows(path):
        if good(int(rating), int(rd), int(pop), int(plays), moves.split()):
            themes.update(t for t in tags.split() if t not in PLAIN)
    typical = sorted(themes.values())[len(themes) // 2]

    # Second pass: weighted reservoir sampling per 50 rating points. A puzzle's weight grows with its popularity and
    # with the rarity of its rarest theme, so a smothered mate is far more likely to be kept than one more fork.
    rng = random.Random(seed)
    heaps: dict[int, list] = {}
    dailies = []
    for pid, fen, moves, rating, rd, pop, plays, tags, url, _, daily in rows(path):
        r, d, p, n, line = int(rating), int(rd), int(pop), int(plays), moves.split()
        row = [pid, fen, moves, r, d, tags, 'l:' + url.removeprefix('https://lichess.org/')]
        # Puzzles lichess picked for its own daily puzzle, the best-loved of all: the pool for Kibitz's.
        if daily and len(line) <= 12:
            dailies.append((daily, row))
        if not good(r, d, p, n, line):
            continue
        rare = max((math.sqrt(typical / themes[t]) for t in tags.split() if t in themes), default=1.0)
        weight = (1 + (p - 85) / 15) * min(rare, 30) * min(1.0, math.log10(n) / 4)
        band = r // 50 * 50
        size = TARGET.get(band // 100 * 100, DEFAULT_TARGET) // 2
        key = rng.random() ** (1 / weight)
        heap = heaps.setdefault(band, [])
        if len(heap) < size:
            heapq.heappush(heap, (key, pid, row))
        elif key > heap[0][0]:
            heapq.heapreplace(heap, (key, pid, row))

    chosen = [row for heap in heaps.values() for _, _, row in heap]
    dailies.sort(key=lambda d: d[0])
    return chosen, [row for _, row in dailies]


def originals(paths: list[Path], games: dict[str, str]) -> list[list]:
    out = []
    for path in paths:
        for line in path.read_text().splitlines():
            if not line.strip():
                continue
            p = json.loads(line)
            src = p.get('source', {})
            if src.get('kind') == 'bots':
                tag = f"b:{src['white']}:{src['black']}"
                if src.get('pgn'):
                    games[p['id']] = src['pgn']
            elif src.get('kind') == 'tablebase':
                tag = f"e:{src['material']}"
            else:
                tag = 'k:'
            out.append([p['id'], p['fen'], ' '.join(p['moves']), int(p['rating']), int(p.get('ratingDeviation', 100)), ' '.join(sorted(set(p['themes']))), tag])
    return out


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument('--lichess', type=Path, required=True, help='lichess_db_puzzle.csv.zst')
    ap.add_argument('--originals', type=Path, nargs='*', default=[], help="Kibitz's own puzzles, tagged and rated (JSONL)")
    ap.add_argument('--out', type=Path, default=Path(__file__).resolve().parent.parent / 'src' / 'puzzles')
    ap.add_argument('--seed', type=int, default=1858)
    args = ap.parse_args()

    lichess, dailies = pick_lichess(args.lichess, args.seed)
    games: dict[str, str] = {}
    ours = originals(args.originals, games)
    # The daily puzzles go in the shards too (most aren't there already), so a link to one finds it.
    chosen = {row[0] for row in lichess}
    for row in dailies:
        if row[0] not in chosen:
            chosen.add(row[0])
            lichess.append(row)
    everything = lichess + ours
    if len({row[0] for row in everything}) != len(everything):
        sys.exit('duplicate puzzle ids')

    data = args.out / 'data'
    shutil.rmtree(data, ignore_errors=True)
    data.mkdir(parents=True)
    shards: list[list] = [[] for _ in range(SHARDS)]
    for row in everything:
        shards[fnv1a(row[0]) % SHARDS].append(row)
    themes: dict[str, list[int]] = {}
    sources: dict[str, list[int]] = {}
    for n, shard in enumerate(shards):
        # Easiest first: the site picks by rating, and sorted shards compress a little better.
        shard.sort(key=lambda row: (row[3], row[0]))
        (data / f'{n}.json').write_text(json.dumps(shard, separators=(',', ':')))
        for row in shard:
            for t in row[5].split():
                themes.setdefault(t, [0] * SHARDS)[n] += 1
            kind = {'b': 'bots', 'e': 'tablebase'}.get(row[6][0])
            if kind:
                sources.setdefault(kind, [0] * SHARDS)[n] += 1

    # In small files, so showing today's puzzle doesn't download five years of them.
    # The bot games Kibitz's own puzzles come from, up to the puzzle: fetched only to show one.
    if games:
        (data / 'games.json').write_text(json.dumps(games, separators=(',', ':')))

    daily = dailies
    for n in range(0, len(daily), DAILY_FILE):
        (data / f'daily-{n // DAILY_FILE}.json').write_text(json.dumps(daily[n : n + DAILY_FILE], separators=(',', ':')))

    index = {
        'shards': SHARDS,
        'count': len(everything),
        'originals': len(ours),
        'dailyEpoch': DAILY_EPOCH,
        'daily': len(daily),
        'dailyFile': DAILY_FILE,
        'themes': dict(sorted(themes.items(), key=lambda kv: -sum(kv[1]))),
        'sources': sources,
    }
    (args.out / 'index.json').write_text(json.dumps(index, separators=(',', ':')))

    size = sum(f.stat().st_size for f in data.iterdir())
    bands = Counter(row[3] // 100 * 100 for row in everything)
    print(f'{len(lichess)} lichess + {len(ours)} Kibitz puzzles in {SHARDS} shards, {size / 1e6:.1f} MB; {len(daily)} daily')
    print('by rating:', ' '.join(f'{b}:{n}' for b, n in sorted(bands.items())))
    print('themes:', ' '.join(f'{t}:{sum(c)}' for t, c in index['themes'].items()))


if __name__ == '__main__':
    main()
