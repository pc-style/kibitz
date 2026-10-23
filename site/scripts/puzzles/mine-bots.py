#!/usr/bin/env python3
# /// script
# requires-python = ">=3.10"
# dependencies = ["chess>=1.11"]
# ///
"""
Mines original puzzles from games between Kibitz's bots.

Pip, Scout, Rook and Sage play each other from varied book openings, the way the Play page runs them:
Stockfish at the bot's Skill Level, a share of random moves, and a mate in one always taken. Then every
move is scored, and a move that throws the game away (the mover was about level or better, and now the
opponent is clearly winning) becomes the setup move of a puzzle, whether or not the other bot punished it.
The line runs while the winning side has exactly one good move and stops once the result is plain: mate,
or material won that the other side can't take back. Every accepted line is searched again, deeper.

From site/:   uv run scripts/puzzles/mine-bots.py --engine /path/to/stockfish --out bots.jsonl --hours 3
              ... --games 32             a small run; the same flags always write the same puzzles
              ... --resume               carries on after the last game already in --out

Writes one puzzle per line in the shared puzzle JSONL format, in game order, as each game is mined, so a run
that is cut short still leaves usable output. Progress goes to stderr. Every random choice is seeded by
--seed and the game's number, and each game starts with a fresh engine hash, so the results don't depend on
which worker played which game.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import math
import multiprocessing.util
import os
import random
import sys
import time
from collections import Counter
from concurrent.futures import ProcessPoolExecutor
from dataclasses import dataclass
from pathlib import Path

import chess
import chess.engine

OPENINGS = Path(__file__).resolve().parent.parent.parent / "src" / "openings.json"


# ---------------------------------------------------------------- the bots


@dataclass(frozen=True)
class Bot:
    name: str
    skill: int  # Stockfish Skill Level
    move_time: int  # milliseconds the site gives each move
    random: float  # share of moves picked uniformly at random


# As in src/play/bots.ts (Stockfish itself is left out: at full strength it hardly blunders). The site's depth
# caps (5, 8, 12, 18) never bind, because Skill Level settles on its move at depth 1 + skill.
BOTS = [Bot("Pip", 0, 300, 0.45), Bot("Scout", 2, 500, 0.15), Bot("Rook", 6, 700, 0.0), Bot("Sage", 14, 1100, 0.0)]

# The site runs the lite single-threaded WASM build. At about 200k nodes a second (a modest phone or laptop) its
# move time becomes a node cap, which only Sage ever reaches.
WASM_NPS = 200

# Games per pairing, relative; a mixed pairing plays either colours. A weak bot against itself makes long games
# that swing back and forth, so Pip and Scout get most of the games. Rook's mistakes seldom lose outright, and Sage
# is slow and rarely blunders, but every pairing still comes up.
PAIRINGS = {
    "Pip-Pip": 7, "Scout-Scout": 7, "Rook-Rook": 1.5, "Sage-Sage": 0.3, "Pip-Scout": 1.5, "Pip-Rook": 1,
    "Scout-Rook": 1, "Pip-Sage": 0.5, "Scout-Sage": 0.5, "Rook-Sage": 0.5,
}


def skill_pick(infos: list[dict], skill: int, turn: chess.Color, rng: random.Random) -> chess.Move:
    """Stockfish's Skill Level choice among its MultiPV 4 lines.

    Stockfish seeds this from the clock, so it is redone here with our generator to keep games reproducible.
    Each line's score gets a push that grows with how far it trails the best and with a random share of the
    spread between first and last (capped at a pawn); the highest pushed score is played.
    """
    lines = [(internal(i["score"].pov(turn)), i["pv"][0]) for i in infos if i.get("pv")]
    top = lines[0][0]
    delta = min(top - lines[-1][0], PAWN_VALUE)
    weakness = 120 - 2 * skill
    best, best_score = lines[0][1], -math.inf
    for score, move in lines:
        push = (weakness * (top - score) + delta * rng.randrange(weakness)) // 128
        if score + push >= best_score:
            best_score, best = score + push, move
    return best


VALUE_MATE = 32000
PAWN_VALUE = 208  # Stockfish's internal pawn
INTERNAL_PER_CP = 3.8  # UCI centipawns are internal units rescaled by material; this is the middlegame factor


def internal(score: chess.engine.Score) -> int:
    if score.is_mate():
        m = score.mate()
        return VALUE_MATE - (2 * m - 1) if m > 0 else -VALUE_MATE + 2 * -m
    return round(score.score() * INTERNAL_PER_CP)


def bot_move(engine, board: chess.Board, bot: Bot, rng: random.Random, key) -> chess.Move:
    moves = list(board.legal_moves)
    # Like the site, even the forgiving bots take a mate in one.
    for move in moves:
        if board.gives_check(move):
            board.push(move)
            mate = board.is_checkmate()
            board.pop()
            if mate:
                return move
    if bot.random and rng.random() < bot.random:
        return rng.choice(moves)
    limit = chess.engine.Limit(depth=1 + bot.skill, nodes=bot.move_time * WASM_NPS)
    infos = engine.analyse(board, limit, multipv=4, game=key, info=INFO)
    return skill_pick(infos, bot.skill, board.turn, rng)


def game_over(board: chess.Board) -> bool:
    # The site ends a game on threefold repetition and the fifty-move rule without anyone claiming them.
    return board.outcome() is not None or board.is_repetition(3) or board.halfmove_clock >= 100


# ---------------------------------------------------------------- openings


def book_weights(book: set[str], names: dict[str, str]) -> dict[str, float]:
    """How much of the opening book lies behind each book position, so random walks favour main lines."""
    size: dict[str, int] = {}

    def visit(board: chess.Board) -> int:
        epd = board.epd()
        if epd not in size:
            size[epd] = 0  # transpositions back into a line already being counted add nothing
            total = 1 if epd in names else 0
            for move in board.legal_moves:
                board.push(move)
                if board.epd() in book:
                    total += visit(board)
                board.pop()
            size[epd] = total
        return size[epd]

    visit(chess.Board())
    # Square roots, so sidelines still come up now and then.
    return {epd: math.sqrt(n) for epd, n in size.items() if n}


def book_walk(rng: random.Random, weights: dict[str, float]) -> list[chess.Move]:
    board, walk = chess.Board(), []
    for _ in range(rng.randint(2, 14)):
        options = []
        for move in board.legal_moves:
            board.push(move)
            if (w := weights.get(board.epd())) is not None:
                options.append((move, w))
            board.pop()
        if not options:
            break
        move = rng.choices([m for m, _ in options], [w for _, w in options])[0]
        board.push(move)
        walk.append(move)
    return walk


def opening_name(moves: list[chess.Move], book: set[str], names: dict[str, str]) -> str | None:
    """The deepest named position the game passed through before leaving the book."""
    board, name = chess.Board(), None
    for move in moves:
        board.push(move)
        epd = board.epd()
        if epd not in book:
            break
        name = names.get(epd, name)
    return name


# ---------------------------------------------------------------- judging moves

INFO = chess.engine.INFO_BASIC | chess.engine.INFO_SCORE | chess.engine.INFO_PV


def win(score: chess.engine.Score | None) -> float:
    """Lichess's win chance, 0 to 100, for the side the score is from."""
    if score is None:
        return 0.0
    if score.is_mate():
        return 100.0 if score.mate() > 0 else 0.0
    return 50 + 50 * (2 / (1 + math.exp(-0.00368208 * score.score())) - 1)


def fmt(score: chess.engine.Score | None) -> str | None:
    if score is None:
        return None
    return f"mate {score.mate()}" if score.is_mate() else f"cp {score.score()}"


BALANCED = win(chess.engine.Cp(-150))  # the mover was about level, or better
SCAN_WIN = win(chess.engine.Cp(200))  # worth a closer look; the closer look wants WIN_MIN
WIN_MIN = win(chess.engine.Cp(300))  # the solver is clearly winning
GAP = 30  # win-chance points between the only move and the next best
DECISIVE = 2  # material won, in pawns, that ends a line
MAX_MOVES = 4  # solver moves in a line won on material
MAX_MATE = 5  # solver moves in a mating line

VALUES = {chess.PAWN: 1, chess.KNIGHT: 3, chess.BISHOP: 3, chess.ROOK: 5, chess.QUEEN: 9, chess.KING: 0}


def balance(board: chess.Board, color: chess.Color) -> int:
    return sum(VALUES[p.piece_type] * (1 if p.color == color else -1) for p in board.piece_map().values())


def analyse(engine, board: chess.Board, nodes: int, multipv: int, key) -> list[dict]:
    infos = engine.analyse(board, chess.engine.Limit(nodes=nodes), multipv=multipv, game=key, info=INFO)
    return [i for i in infos if i.get("pv")]


def judge(infos: list[dict], solver: chess.Color, horizon: int) -> dict | None:
    """Evidence that the engine's first choice is the only move that keeps the win, or None.

    A mate within `horizon` solver moves will be played out, so it is judged by its length; a longer one only
    wins, so it is judged like any other win.
    """
    best = infos[0]["score"].pov(solver)
    second = infos[1]["score"].pov(solver) if len(infos) > 1 else None
    ev = {"depth": infos[0].get("depth"), "best": fmt(best), "second": fmt(second)}
    if best.is_mate() and 0 < best.mate() <= horizon:
        # Any mate is accepted on the last move, so only a longer mate needs to be the one move that mates soonest.
        n = best.mate()
        if n > 1 and second is not None and second.is_mate() and 0 < second.mate() <= n:
            return None
        ev["gap"] = round(100 - win(second), 1)
        return ev
    if win(best) < WIN_MIN:
        return None
    ev["gap"] = round(win(best) - win(second), 1)
    return ev if second is None or ev["gap"] >= GAP else None


# ---------------------------------------------------------------- puzzles


class Reject(Exception):
    """A candidate that makes no puzzle; the message is the reason, counted in the run's report."""


def build(engine, fen: str, blunder: chess.Move, nodes: int, key) -> tuple[list[chess.Move], str, int]:
    """The line that punishes the blunder: (moves from the blunder on, how it ends, material won)."""
    board = chess.Board(fen)
    board.push(blunder)
    solver = board.turn
    if board.legal_moves.count() < 2:
        raise Reject("forced")
    start = balance(board, solver)
    line, gain, end = [blunder], None, None
    for k in range(MAX_MATE):
        infos = analyse(engine, board, nodes, 2, key)
        if not infos or judge(infos, solver, MAX_MATE - k) is None:
            if k == 0:
                raise Reject("not winning" if not infos or win(infos[0]["score"].pov(solver)) < WIN_MIN else "several")
            break
        best = infos[0]["score"].pov(solver)
        # A mate that fits is followed to the end; anything else stops once material is won for good.
        mating = best.is_mate() and best.mate() <= MAX_MATE - k
        if not mating and k >= MAX_MOVES:
            break
        line.append(infos[0]["pv"][0])
        board.push(line[-1])
        if board.is_checkmate():
            end = "mate"
            break
        if game_over(board):
            raise Reject("drawn")
        reply = analyse(engine, board, nodes, 1, key)[0]["pv"][0]
        board.push(reply)
        gain = balance(board, solver) - start
        board.pop()
        if not mating and gain >= DECISIVE and not board.is_capture(reply):
            end = "material"
            break
        board.push(reply)
        line.append(reply)
    if end is None:
        # The solver had more than one good move here: end on the last only move, if it had already won enough.
        if len(line) % 2:
            line.pop()
        if gain is None or gain < DECISIVE:
            raise Reject("unclear")
        end = "material"

    # A lone recapture is no puzzle, and nor is one that only wins back what the blunder took.
    before = chess.Board(fen)
    if end != "mate" and before.is_capture(blunder) and line[1].to_square == blunder.to_square:
        if len(line) == 2 or gain + start - balance(before, solver) < DECISIVE:
            raise Reject("recapture")
    return line, end, gain or 0


def verify(engine, fen: str, line: list[chess.Move], end: str, nodes: int, key) -> list[dict]:
    """Searches every position of the line again, deeper; the evidence for each move."""
    board = chess.Board(fen)
    board.push(line[0])
    solver = board.turn
    steps = []
    for i, move in enumerate(line[1:]):
        infos = analyse(engine, board, nodes, 2, key)
        if board.turn == solver:
            ev = judge(infos, solver, len(line) // 2 - i // 2 if end == "mate" else 0)
            if ev is None:
                raise Reject("verify: not only")
            if infos[0]["pv"][0] != move:
                # Only a different mate in one may stand in for the expected move.
                board.push(move)
                mate = board.is_checkmate()
                board.pop()
                if not mate:
                    raise Reject("verify: other best")
        else:
            # The reply must be the most stubborn defence, or as stubborn as it.
            ours = next((i for i in infos if i["pv"][0] == move), None)
            got, top = ours and ours["score"].pov(board.turn), infos[0]["score"].pov(board.turn)
            if got is None or (got != top if top.is_mate() or got.is_mate() else win(top) - win(got) > 2):
                raise Reject("verify: reply")
            ev = {"depth": ours.get("depth"), "score": fmt(ours["score"].pov(solver))}
        steps.append(ev)
        board.push(move)
    # A mate must be as short as the line, or its theme would be wrong.
    if end == "mate" and steps[0]["best"] != f"mate {len(line) // 2}":
        raise Reject("verify: shorter mate")
    return steps


def phase(board: chess.Board) -> str:
    """Rough game phase, for the run's report only (the tagger sets the real themes)."""
    pieces = sum(VALUES[p.piece_type] for p in board.piece_map().values() if p.piece_type != chess.PAWN)
    if pieces <= 20:
        return "endgame"
    return "opening" if board.ply() < 24 and pieces >= 46 else "middlegame"


# ---------------------------------------------------------------- one game, in a worker

ENGINE = None
SHARED: dict = {}


def init_worker(engine_path: str, hash_mb: int, book: set[str], names: dict[str, str], weights: dict[str, float]):
    global ENGINE
    ENGINE = chess.engine.SimpleEngine.popen_uci(engine_path)
    ENGINE.configure({"Hash": hash_mb, "Threads": 1})
    # The engine's thread would keep the worker from exiting; multiprocessing runs this first.
    multiprocessing.util.Finalize(None, ENGINE.quit, exitpriority=10)
    SHARED.update(book=book, names=names, weights=weights)


def cpu_seconds() -> float:
    """CPU time of this worker and its engine so far."""
    t = os.times()
    total = t.user + t.system
    try:
        stat = Path(f"/proc/{ENGINE.transport.get_pid()}/stat").read_text().rsplit(")", 1)[1].split()
        total += (int(stat[11]) + int(stat[12])) / os.sysconf("SC_CLK_TCK")
    except (OSError, AttributeError, IndexError, ValueError):
        pass
    return total


def pairing(rng: random.Random) -> tuple[Bot, Bot]:
    bots = {bot.name: bot for bot in BOTS}
    one, two = (bots[name] for name in rng.choices(list(PAIRINGS), list(PAIRINGS.values()))[0].split("-"))
    return (one, two) if rng.random() < 0.5 else (two, one)


def mine_game(index: int, seed: int, opts: dict) -> dict:
    started = time.time()
    rng = random.Random(f"{seed}:{index}")
    key = (seed, index)  # a new key makes python-chess send ucinewgame, which clears the hash
    white, black = pairing(rng)
    walk = book_walk(rng, SHARED["weights"])
    board = chess.Board()
    for move in walk:
        board.push(move)
    while board.ply() < opts["max_plies"] and not game_over(board):
        bot = white if board.turn == chess.WHITE else black
        board.push(bot_move(ENGINE, board, bot, rng, key))
    moves = board.move_stack
    result = board.result(claim_draw=True) if game_over(board) else "*"

    # Score every position the bots played from, for the side to move.
    scans: list[tuple[float, str]] = []
    replay = chess.Board()
    for move in walk:
        replay.push(move)
    for i in range(len(walk), len(moves) + 1):
        if replay.is_checkmate():
            scans.append((0.0, "mated"))
        elif game_over(replay):
            scans.append((50.0, "draw"))
        else:
            info = analyse(ENGINE, replay, opts["scan_nodes"], 1, key)[0]
            scans.append((win(info["score"].relative), fmt(info["score"].relative)))
        if i < len(moves):
            replay.push(moves[i])

    opening = opening_name(moves, SHARED["book"], SHARED["names"])
    puzzles, seen, candidates, rejects = [], set(), 0, Counter()
    for i in range(len(walk), len(moves)):
        before, after = scans[i - len(walk)], scans[i + 1 - len(walk)]
        if before[0] < BALANCED or after[0] < SCAN_WIN:
            continue
        candidates += 1
        pre = chess.Board()
        for move in moves[:i]:
            pre.push(move)
        fen = pre.fen()
        pos = pre.copy(stack=False)
        pos.push(moves[i])
        try:
            line, end, gain = build(ENGINE, fen, moves[i], opts["nodes"], key)
            # Near-identical puzzles from the same game: the same position after the blunder, or the same answer.
            same = {pos.epd(), tuple(m.uci() for m in line[1:])}
            if same & seen:
                raise Reject("same game")
            steps = verify(ENGINE, fen, line, end, opts["nodes"] * opts["verify_factor"], key)
        except Reject as reject:
            rejects[str(reject)] += 1
            continue
        seen |= same
        solver_moves = len(line) // 2
        uci = [m.uci() for m in line]
        first = line[1]
        puzzles.append({
            "fen": fen,
            "moves": uci,
            "themes": ["mate", f"mateIn{solver_moves}"] if end == "mate" else [],
            "source": {
                "kind": "bots",
                "white": white.name,
                "black": black.name,
                "pgn": chess.Board().variation_san(moves[: i + 1]),
                **({"opening": opening} if opening else {}),
            },
            "verify": {
                "engine": "Stockfish 19",
                "nodes": opts["nodes"] * opts["verify_factor"],
                "build_nodes": opts["nodes"],
                "steps": steps,
                "end": end,
                **({"material": gain} if end == "material" else {}),
                "scan": {"nodes": opts["scan_nodes"], "before": before[1], "after": after[1]},
                "game": index,
                "ply": i + 1,
                "found": i + 1 < len(moves) and moves[i + 1] == first,
            },
            # Kept by the parent for the run's report, never written.
            "_stats": {
                "phase": phase(pre),
                "blunderer": (white if pre.turn == chess.WHITE else black).name,
                "first": "capture" if pos.is_capture(first) else "check" if pos.gives_check(first) else "quiet",
                "epd": [pre.epd(), pos.epd()],
            },
        })
    return {
        "index": index,
        "white": white.name,
        "black": black.name,
        "plies": len(moves),
        "result": result,
        "candidates": candidates,
        "rejects": rejects,
        "puzzles": puzzles,
        "seconds": time.time() - started,
        "worker": os.getpid(),
        "cpu": cpu_seconds(),
    }


# ---------------------------------------------------------------- the run


def main():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--engine", default="stockfish", help="UCI engine (Stockfish 19)")
    parser.add_argument("--out", default="bots.jsonl")
    parser.add_argument("--openings", default=str(OPENINGS))
    parser.add_argument("--games", type=int, default=1_000_000, help="stop after this many games")
    parser.add_argument("--hours", type=float, help="stop starting games after this long")
    parser.add_argument("--workers", type=int, default=3, help="one single-threaded engine each")
    parser.add_argument("--seed", type=int, default=1)
    parser.add_argument("--hash", type=int, default=64, help="MB per engine")
    parser.add_argument("--scan-nodes", type=int, default=15_000, help="per position, to find blunders")
    parser.add_argument("--nodes", type=int, default=300_000, help="per position, to build a line")
    parser.add_argument("--verify-factor", type=int, default=5, help="re-search accepted lines with this many times the nodes")
    parser.add_argument("--max-plies", type=int, default=300)
    parser.add_argument("--resume", action="store_true", help="append to --out, after the last game in it")
    args = parser.parse_args()

    data = json.loads(Path(args.openings).read_text())
    book, names = set(data["book"]), data["names"]
    weights = book_weights(book, names)
    opts = {k: getattr(args, k) for k in ("scan_nodes", "nodes", "verify_factor", "max_plies")}

    out = Path(args.out)
    seen_ids, seen_pos, first_game = set(), set(), 0
    if args.resume and out.exists():
        for row in map(json.loads, out.read_text().splitlines()):
            seen_ids.add(row["id"])
            pre = chess.Board(row["fen"])
            seen_pos.add(pre.epd())
            pre.push_uci(row["moves"][0])
            seen_pos.add(pre.epd())
            first_game = max(first_game, row["verify"]["game"] + 1)
    else:
        out.write_text("")

    deadline = time.time() + args.hours * 3600 if args.hours else math.inf
    started = time.time()
    stats: Counter = Counter()
    cpu: dict[int, float] = {}
    window = args.workers * 4
    with out.open("a") as sink, ProcessPoolExecutor(
        args.workers, initializer=init_worker, initargs=(args.engine, args.hash, book, names, weights)
    ) as pool:
        pending, next_game = {}, first_game
        for index in range(first_game, first_game + args.games):
            # Games are handed out in order and written in order, so the output doesn't depend on timing.
            while next_game < first_game + args.games and len(pending) < window and time.time() < deadline:
                pending[next_game] = pool.submit(mine_game, next_game, args.seed, opts)
                next_game += 1
            if index not in pending:
                break
            game = pending.pop(index).result()
            cpu[game["worker"]] = game["cpu"]
            pair = f"{game['white']}-{game['black']}"
            stats["games"] += 1
            stats[f"games {pair}"] += 1
            stats["candidates"] += game["candidates"]
            stats.update({f"reject {k}": v for k, v in game["rejects"].items()})
            stats["plies"] += game["plies"]
            for p in game["puzzles"]:
                s = p.pop("_stats")
                p = {"id": "kb" + hashlib.sha1(f"{p['fen']} {' '.join(p['moves'])}".encode()).hexdigest()[:6], **p}
                if p["id"] in seen_ids or seen_pos & set(s["epd"]):
                    stats["duplicates"] += 1
                    continue
                seen_ids.add(p["id"])
                seen_pos.update(s["epd"])
                sink.write(json.dumps(p, separators=(",", ":")) + "\n")
                n = len(p["moves"]) // 2
                stats["puzzles"] += 1
                for k in (f"pair {pair}", f"phase {s['phase']}", f"by {s['blunderer']}", f"first {s['first']}",
                          f"len {n}", f"end {p['verify']['end']}", f"found {p['verify']['found']}"):
                    stats[k] += 1
            sink.flush()
            elapsed = time.time() - started
            print(
                f"[{elapsed / 60:6.1f} min] game {game['index']} {pair} {game['plies']} plies {game['result']} "
                f"{game['seconds']:.0f}s: "
                f"{len(game['puzzles'])}/{game['candidates']} | total {stats['puzzles']} puzzles from "
                f"{stats['games']} games, cpu {sum(cpu.values()) / 60:.1f} min",
                file=sys.stderr,
                flush=True,
            )

    elapsed = time.time() - started
    print(f"\n{stats['puzzles']} puzzles from {stats['games']} games ({stats['candidates']} candidates) "
          f"in {elapsed / 60:.1f} min wall, {sum(cpu.values()) / 60:.1f} min cpu", file=sys.stderr)
    for k in sorted(stats):
        print(f"  {k}: {stats[k]}", file=sys.stderr)


if __name__ == "__main__":
    main()
