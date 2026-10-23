#!/usr/bin/env python3
# /// script
# requires-python = ">=3.10"
# dependencies = ["python-chess==1.999", "chess==1.11.2"]
# ///
"""
Makes original, seeded endgame puzzles, proving every move with Syzygy.

    uv run scripts/puzzles/endgames.py --tablebases /path/to/tables --count 800 \
        --output /path/to/endgames.jsonl --report /path/to/report.json
    uv run scripts/puzzles/endgames.py --tablebases /path/to/tables \
        --verify-only /path/to/endgames.jsonl
    uv run scripts/puzzles/endgames.py --download-plan

Download the URLs printed by --download-plan before running. The old Lichess
3-4-5/ directory is now split into 3-4-5-wdl/ and 3-4-5-dtz/. The default
closure includes every three/four-piece table and all promotion/capture
dependencies of the selected five-piece endings (98 files, about 155 MB).
This script never downloads anything and uses no engine or worker threads.

WDL values are from the side to move, or from the moving side for move lists.
DTZ includes the candidate ply; zeroing moves have distance one, not the next
phase's distance. Cursed wins and blessed losses are rejected conservatively.
The fifty-move margin also allows for Syzygy's one-ply rounding.
"""

from __future__ import annotations

import argparse
from collections import Counter
from dataclasses import dataclass
import hashlib
import json
from pathlib import Path
import random
import sys
import time

import chess
import chess.syzygy


MATERIALS = {
    "KPvK": 18, "KPPvK": 12, "KPvKP": 16,
    "KRPvKR": 20, "KRvKP": 8, "KQvKP": 5, "KQvKR": 3,
    "KRvKB": 3, "KRvKN": 3, "KBPvK": 5, "KNPvK": 4,
    "KRPvKB": 2, "KBPvKB": 6,
}
VALUES = {chess.PAWN: 1, chess.KNIGHT: 3, chess.BISHOP: 3,
          chess.ROOK: 5, chess.QUEEN: 9, chess.KING: 0}


class Reject(Exception):
    pass


def key(board: chess.Board) -> str:
    return " ".join(board.fen().split()[:4])


def rank(square: chess.Square, color: chess.Color) -> int:
    return chess.square_rank(square) if color else 7 - chess.square_rank(square)


def required_tables(materials: list[str]) -> list[str]:
    small = list(chess.syzygy.tablenames(piece_count=4))
    return sorted(set(chess.syzygy.all_dependencies(small + materials)))


@dataclass(frozen=True)
class Choice:
    move: chess.Move
    wdl: int
    dtz: int
    capture_value: int
    check: bool

    def evidence(self) -> dict:
        return {"move": self.move.uci(), "wdl": self.wdl, "dtz": self.dtz}


class Prober:
    def __init__(self, tablebase: chess.syzygy.Tablebase):
        self.tb = tablebase
        self.probes = 0

    def wdl(self, board: chess.Board) -> int:
        self.probes += 1
        value = self.tb.probe_wdl(board)
        if abs(value) == 1:
            raise Reject("fifty_move_ambiguous")
        return value

    def dtz(self, board: chess.Board) -> int:
        self.probes += 1
        value = self.tb.probe_dtz(board)
        if value and abs(value) + board.halfmove_clock + 1 >= 100:
            raise Reject("fifty_move_margin")
        return value

    def choices(self, board: chess.Board) -> list[Choice]:
        result = []
        for move in sorted(board.legal_moves, key=lambda m: m.uci()):
            zeroing = board.is_zeroing(move)
            captured = board.piece_type_at(move.to_square)
            board.push(move)
            try:
                wdl = -self.wdl(board)
                child_dtz = self.dtz(board)
                distance = 1 if zeroing or board.is_checkmate() else abs(child_dtz) + 1
                result.append(Choice(move, wdl, distance if wdl else 0,
                                     VALUES.get(captured, 0), board.is_check()))
            finally:
                board.pop()
        return result


def stubborn(choices: list[Choice]) -> Choice:
    best_wdl = max(c.wdl for c in choices)
    eligible = [c for c in choices if c.wdl == best_wdl]
    # Delay the next reset when lost; make progress when winning. Draw ties
    # favor material recovery, queen promotions and checks, then stable UCI.
    return min(eligible, key=lambda c: (
        -c.dtz if best_wdl < 0 else c.dtz,
        -c.capture_value, -VALUES.get(c.move.promotion, 0),
        -int(c.check), c.move.uci()))


def unique(choices: list[Choice], target: int) -> Choice | None:
    good = [c for c in choices if c.wdl == target]
    return good[0] if len(good) == 1 and len(choices) > 1 else None


def continuation(board: chess.Board, prober: Prober, target: int) -> dict:
    if board.is_game_over():
        return {"opponent": None, "goodMoves": []}
    reply = stubborn(prober.choices(board))
    board.push(reply.move)
    try:
        good = [c.move.uci() for c in prober.choices(board) if c.wdl == target]
        return {"opponent": reply.move.uci(), "goodMoves": good}
    finally:
        board.pop()


def clear_result(board: chess.Board, solver: bool, target: int,
                 last: chess.Move, was_capture: bool) -> str | None:
    if board.is_checkmate():
        return "checkmate" if target == 2 else None
    if target == 0 and (board.is_stalemate() or board.is_insufficient_material()):
        return "stalemate" if board.is_stalemate() else "insufficient_material"
    pieces = board.piece_map()
    ours = [(sq, p) for sq, p in pieces.items() if p.color == solver and p.piece_type != chess.KING]
    theirs = [(sq, p) for sq, p in pieces.items() if p.color != solver and p.piece_type != chess.KING]
    if target == 2:
        # A promotion is only a stopping point if the new piece cannot simply
        # be taken and the remaining material advantage is familiar.
        if last.promotion in (chess.QUEEN, chess.ROOK):
            advantage = sum(VALUES[p.piece_type] for _, p in ours) - sum(VALUES[p.piece_type] for _, p in theirs)
            if advantage >= 4 and not any(m.to_square == last.to_square for m in board.legal_moves):
                return "safe_promotion"
        if was_capture and not theirs and any(p.piece_type in (chess.ROOK, chess.QUEEN) for _, p in ours):
            if not any(board.is_capture(m) for m in board.legal_moves):
                return "decisive_material"
        if not theirs and ours and all(p.piece_type == chess.PAWN for _, p in ours):
            enemy_king = board.king(not solver)
            for square, _ in ours:
                step = 8 if solver else -8
                path = list(range(square + step, (56 + chess.square_file(square) if solver else chess.square_file(square)) + step, step))
                if path and all(not board.piece_at(sq) and chess.square_distance(enemy_king, sq) > i
                                for i, sq in enumerate(path, 1)):
                    return "unstoppable_pawn"
            if len(ours) == 1:
                square = ours[0][0]
                king = board.king(solver)
                if (chess.square_file(square) not in (0, 7)
                        and rank(square, solver) == 4 and rank(king, solver) == 5
                        and abs(chess.square_file(king) - chess.square_file(square)) <= 1):
                    return "king_on_sixth_rank"
        return None

    if was_capture and len(ours) == len(theirs) == 1:
        if ours[0][1].piece_type == theirs[0][1].piece_type in (chess.ROOK, chess.QUEEN):
            if not any(board.is_capture(m) for m in board.legal_moves):
                return "equal_major_piece_ending"
        if all(p.piece_type in (chess.BISHOP, chess.KNIGHT) for _, p in ours + theirs):
            return "bare_minor_piece_ending"
    # Recognizable pawn-endgame drawing positions, with WDL as the proof.
    if not ours and len(theirs) == 1 and theirs[0][1].piece_type == chess.PAWN:
        pawn = theirs[0][0]
        attacker = not solver
        defender_king, attacking_king = board.king(solver), board.king(attacker)
        file = chess.square_file(pawn)
        promotion = chess.square(file, 7 if attacker else 0)
        if file in (0, 7) and defender_king == promotion:
            return "rook_pawn_corner"
        if (chess.square_file(defender_king) == chess.square_file(attacking_king) == file
                and rank(defender_king, attacker) - rank(attacking_king, attacker) == 2
                and rank(pawn, attacker) < rank(attacking_king, attacker) <= 4):
            return "opposition"
        if defender_king == promotion and rank(pawn, attacker) == 6:
            return "blocked_seventh_rank_pawn"
    if not ours and len(theirs) == 2:
        pawns = [sq for sq, p in theirs if p.piece_type == chess.PAWN]
        bishops = [sq for sq, p in theirs if p.piece_type == chess.BISHOP]
        if len(pawns) == len(bishops) == 1 and chess.square_file(pawns[0]) in (0, 7):
            promotion = chess.square(chess.square_file(pawns[0]), 0 if solver else 7)
            if (board.king(solver) == promotion
                    and bool(chess.BB_SQUARES[bishops[0]] & chess.BB_DARK_SQUARES)
                    != bool(chess.BB_SQUARES[promotion] & chess.BB_DARK_SQUARES)):
                return "wrong_bishop_rook_pawn"
    if len(ours) == 1 and ours[0][1].piece_type == chess.ROOK and len(theirs) == 2:
        pawns = [sq for sq, p in theirs if p.piece_type == chess.PAWN]
        rooks = [sq for sq, p in theirs if p.piece_type == chess.ROOK]
        if len(pawns) == len(rooks) == 1:
            attacker = not solver
            king = board.king(solver)
            if (rank(ours[0][0], attacker) == 5 and rank(board.king(attacker), attacker) <= 4
                    and rank(pawns[0], attacker) <= 4 and rank(king, attacker) >= 6
                    and abs(chess.square_file(king) - chess.square_file(pawns[0])) <= 1
                    and not any(m.to_square == ours[0][0] for m in board.legal_moves)):
                return "philidor_sixth_rank_defence"
    return None


def plausible(board: chess.Board) -> bool:
    if not board.is_valid() or board.is_game_over():
        return False
    pawns = board.pieces(chess.PAWN, chess.WHITE) | board.pieces(chess.PAWN, chess.BLACK)
    if pawns:
        # Active kings and connected pawns avoid arbitrary scattered diagrams.
        for color in chess.COLORS:
            if min(chess.square_distance(board.king(color), p) for p in pawns) > 4:
                return False
            own = list(board.pieces(chess.PAWN, color))
            if len(own) == 2 and (abs(chess.square_file(own[0]) - chess.square_file(own[1])) > 2
                                  or abs(chess.square_rank(own[0]) - chess.square_rank(own[1])) > 2):
                return False
    return True


def candidate(material: str, rng: random.Random) -> chess.Board | None:
    board = chess.Board(None)
    for color, group in zip((chess.WHITE, chess.BLACK), material.split("v")):
        for symbol in group:
            piece_type = chess.PIECE_SYMBOLS.index(symbol.lower())
            squares = [sq for sq in chess.SQUARES if not board.piece_at(sq)
                       and (piece_type != chess.PAWN or 2 <= rank(sq, color) <= 6)]
            square = rng.choice(squares)
            board.set_piece_at(square, chess.Piece(piece_type, color))
    board.turn = rng.choice(chess.COLORS)
    board.fullmove_number = 40
    if rng.randrange(2):
        board = board.mirror()
    return board if plausible(board) else None


def setup(board: chess.Board, prober: Prober, rng: random.Random,
          target: int) -> tuple[chess.Board, chess.Move, dict] | None:
    mover = not board.turn
    possibilities = []
    for to_square, piece in sorted(board.piece_map().items()):
        if piece.color != mover:
            continue
        for from_square in chess.SQUARES:
            if board.piece_at(from_square):
                continue
            if piece.piece_type == chess.PAWN:
                if to_square - from_square != (8 if mover else -8):
                    continue
                if rank(from_square, mover) not in range(1, 6):
                    continue
            elif chess.square_distance(from_square, to_square) > 3:
                continue
            before = board.copy(stack=False)
            before.remove_piece_at(to_square)
            before.set_piece_at(from_square, piece)
            before.turn = mover
            before.halfmove_clock = 0
            before.fullmove_number = 39 if mover == chess.BLACK else 40
            move = chess.Move(from_square, to_square)
            if not before.is_valid() or move not in before.legal_moves or not plausible(before):
                continue
            possibilities.append((before, move))
    rng.shuffle(possibilities)
    fallback = None
    for before, move in possibilities:
        try:
            old_wdl = prober.wdl(before)
            after = before.copy()
            after.push(move)
            new_wdl = -prober.wdl(after)
            prober.dtz(before)
            if new_wdl != -target:
                continue
            evidence = {"move": move.uci(), "beforeWdl": old_wdl,
                        "afterWdl": new_wdl, "mistake": old_wdl > new_wdl}
            if old_wdl > new_wdl:
                choices = prober.choices(before)
                better = stubborn(choices)
                evidence["betterMove"] = better.move.uci()
                evidence["betterWdl"] = better.wdl
                return before, move, evidence
            if fallback is None:
                fallback = before, move, evidence
        except Reject:
            continue
    return fallback


def themes_for(board: chess.Board, moves: list[str], solver: bool,
               target: int, zugzwang: bool) -> list[str]:
    themes = {"endgame"}
    types = {p.piece_type for p in board.piece_map().values()} - {chess.KING, chess.PAWN}
    material_theme = {frozenset(): "pawnEndgame", frozenset([chess.ROOK]): "rookEndgame",
                      frozenset([chess.QUEEN]): "queenEndgame", frozenset([chess.BISHOP]): "bishopEndgame",
                      frozenset([chess.KNIGHT]): "knightEndgame",
                      frozenset([chess.QUEEN, chess.ROOK]): "queenRookEndgame"}.get(frozenset(types))
    if material_theme:
        themes.add(material_theme)
    if target == 0:
        themes.update(("defensiveMove", "equality"))
    if zugzwang:
        themes.add("zugzwang")
    replay = board.copy(stack=False)
    for index, uci in enumerate(moves):
        move = chess.Move.from_uci(uci)
        if index % 2:
            if replay.piece_type_at(move.from_square) == chess.PAWN and rank(move.to_square, solver) in (5, 6):
                themes.add("advancedPawn")
            if move.promotion:
                themes.add("promotion")
                if move.promotion != chess.QUEEN:
                    themes.add("underPromotion")
        replay.push(move)
    if replay.is_checkmate():
        themes.update(("mate", f"mateIn{len(moves) // 2}"))
    return sorted(themes)


def opponent_pass(board: chess.Board, prober: Prober) -> int | None:
    """
    The solver's result if the opponent, now to move, could pass instead. Zugzwang is when that's worse than the
    real result: the opponent loses (or fails to win) only because they have to move. None when passing would
    leave an illegal position (the opponent is in check) or a finished game.
    """
    passed = board.copy(stack=False)
    passed.turn = not passed.turn
    passed.ep_square = None
    if not passed.is_valid() or passed.is_game_over():
        return None
    return prober.wdl(passed)


def make_puzzle(board: chess.Board, material: str, prober: Prober,
                rng: random.Random) -> dict:
    target = prober.wdl(board)
    if target not in (0, 2):
        raise Reject("losing_side")
    start_dtz = prober.dtz(board)
    solver = board.turn
    first_choices = prober.choices(board)
    if unique(first_choices, target) is None:
        raise Reject("not_unique")
    unmove = setup(board, prober, rng, target)
    if unmove is None:
        raise Reject("no_legal_setup")
    before, setup_move, setup_evidence = unmove
    line = [setup_move.uci()]
    replay = before.copy(stack=False)
    replay.push(setup_move)
    proof = []
    zugzwang = False
    positions = {key(replay)}
    for index in range(5):
        choices = first_choices if index == 0 else prober.choices(replay)
        best = unique(choices, target)
        if best is None:
            raise Reject("not_clear_before_nonunique")
        proof.append({"ply": len(line), "role": "solver", "wdl": target,
                      "dtz": prober.dtz(replay),
                      "choices": [c.evidence() for c in choices]})
        was_capture = replay.is_capture(best.move)
        replay.push(best.move)
        pass_wdl = opponent_pass(replay, prober)
        proof[-1]["opponentPassWdl"] = pass_wdl
        zugzwang |= pass_wdl is not None and pass_wdl < target
        line.append(best.move.uci())
        reason = clear_result(replay, solver, target, best.move, was_capture)
        if reason:
            # A lone hanging-piece pickup is valid chess but teaches little
            # about endgames. Keep captures that finish a longer calculation.
            if index == 0 and was_capture and not best.move.promotion and reason != "checkmate":
                raise Reject("trivial_capture")
        boundary = continuation(replay, prober, target) if reason else None
        if reason and len(boundary["goodMoves"]) != 1:
            fen = before.fen()
            digest = hashlib.sha1((fen + " " + " ".join(line)).encode()).hexdigest()[:6]
            return {"id": "ke" + digest, "fen": fen, "moves": line,
                    "themes": themes_for(before, line, solver, target, zugzwang),
                    "source": {"kind": "tablebase", "material": material},
                    "verify": {"method": "syzygy-wdl-dtz", "wdl": target, "dtz": start_dtz,
                               "solver": "white" if solver else "black", "setup": setup_evidence,
                               "endpoint": reason, "finalFen": replay.fen(), "plies": proof,
                               "continuation": boundary}}
        if index == 4:
            break
        choices = prober.choices(replay)
        if not choices:
            raise Reject("unclear_terminal")
        reply = stubborn(choices)
        proof.append({"ply": len(line), "role": "opponent", "wdl": prober.wdl(replay),
                      "dtz": prober.dtz(replay), "choices": [c.evidence() for c in choices]})
        replay.push(reply.move)
        line.append(reply.move.uci())
        if key(replay) in positions:
            raise Reject("repetition")
        positions.add(key(replay))
    raise Reject("too_long_or_unclear")


def verify_puzzle(puzzle: dict, prober: Prober) -> None:
    board = chess.Board(puzzle["fen"])
    moves = puzzle["moves"]
    assert 2 <= len(moves) <= 10 and len(moves) % 2 == 0
    assert board.is_valid()
    expected_id = "ke" + hashlib.sha1((puzzle["fen"] + " " + " ".join(moves)).encode()).hexdigest()[:6]
    assert puzzle["id"] == expected_id
    solver = not board.turn
    target = puzzle["verify"]["wdl"]
    setup_wdl = prober.wdl(board)
    setup_move = chess.Move.from_uci(moves[0])
    assert setup_move in board.legal_moves and not board.is_capture(setup_move)
    assert not setup_move.promotion and not board.is_castling(setup_move)
    if board.piece_type_at(setup_move.from_square) == chess.PAWN:
        assert abs(setup_move.to_square - setup_move.from_square) == 8
    board.push(setup_move)
    assert prober.wdl(board) == target
    assert prober.dtz(board) == puzzle["verify"]["dtz"]
    setup_evidence = puzzle["verify"]["setup"]
    assert setup_evidence["beforeWdl"] == setup_wdl
    assert setup_evidence["afterWdl"] == -target
    assert setup_evidence["mistake"] == (setup_wdl > -target)
    if setup_evidence["mistake"]:
        old = chess.Board(puzzle["fen"])
        choices = prober.choices(old)
        better = next(c for c in choices if c.move.uci() == setup_evidence["betterMove"])
        assert better.wdl == setup_evidence["betterWdl"] == setup_wdl
    zugzwang = False
    for index, uci in enumerate(moves[1:], 1):
        assert board.is_valid()
        choices = prober.choices(board)
        evidence = puzzle["verify"]["plies"][index - 1]
        assert evidence["ply"] == index
        assert evidence["choices"] == [c.evidence() for c in choices]
        assert evidence["wdl"] == prober.wdl(board)
        assert evidence["dtz"] == prober.dtz(board)
        if index % 2:
            expected = unique(choices, target)
            assert expected is not None
        else:
            expected = stubborn(choices)
        assert expected.move.uci() == uci
        was_capture = board.is_capture(expected.move)
        board.push(expected.move)
        assert board.is_valid()
        if index % 2:
            pass_wdl = opponent_pass(board, prober)
            assert evidence["opponentPassWdl"] == pass_wdl
            zugzwang |= pass_wdl is not None and pass_wdl < target
    assert prober.wdl(board) == -target
    assert clear_result(board, solver, target, expected.move, was_capture) == puzzle["verify"]["endpoint"]
    assert board.fen() == puzzle["verify"]["finalFen"]
    boundary = continuation(board, prober, target)
    assert boundary == puzzle["verify"]["continuation"]
    assert len(boundary["goodMoves"]) != 1
    assert themes_for(chess.Board(puzzle["fen"]), moves, solver, target, zugzwang) == puzzle["themes"]


def summarize(puzzles: list[dict]) -> dict:
    return {"count": len(puzzles),
            "byMaterial": dict(sorted(Counter(p["source"]["material"] for p in puzzles).items())),
            "byOutcome": dict(Counter("win" if p["verify"]["wdl"] == 2 else "draw" for p in puzzles)),
            "bySolverMoves": dict(sorted(Counter(len(p["moves"]) // 2 for p in puzzles).items())),
            "byTheme": dict(sorted(Counter(t for p in puzzles for t in p["themes"]).items())),
            "byEndpoint": dict(sorted(Counter(p["verify"]["endpoint"] for p in puzzles).items())),
            "setupMistakes": sum(p["verify"]["setup"]["mistake"] for p in puzzles)}


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--tablebases", type=Path)
    parser.add_argument("--output", type=Path, default=Path("endgames.jsonl"))
    parser.add_argument("--report", type=Path)
    parser.add_argument("--count", type=int, default=800)
    parser.add_argument("--seed", type=int, default=20261023)
    parser.add_argument("--max-attempts", type=int, default=2000000)
    parser.add_argument("--max-seconds", type=float, default=9000)
    parser.add_argument("--materials", nargs="+", choices=list(MATERIALS), default=list(MATERIALS))
    parser.add_argument("--verify-only", type=Path)
    parser.add_argument("--download-plan", action="store_true")
    args = parser.parse_args()
    required = required_tables(args.materials)
    if args.download_plan:
        for name in required:
            for kind, extension in (("wdl", "rtbw"), ("dtz", "rtbz")):
                print(f"https://tablebase.lichess.ovh/tables/standard/3-4-5-{kind}/{name}.{extension}")
        return
    if args.tablebases is None:
        parser.error("--tablebases is required; see --download-plan")
    missing = [f"{name}.{extension}" for name in required for extension in ("rtbw", "rtbz")
               if not (args.tablebases / f"{name}.{extension}").is_file()]
    if missing:
        parser.error("missing tablebases: " + ", ".join(missing))
    started, cpu_started = time.monotonic(), time.process_time()
    puzzles = []
    rejected = Counter()
    attempts = 0
    with chess.syzygy.open_tablebase(str(args.tablebases), max_fds=128) as tablebase:
        prober = Prober(tablebase)
        if args.verify_only:
            seen, ids, solver_seen = set(), set(), set()
            with args.verify_only.open() as source:
                for raw in source:
                    puzzle = json.loads(raw)
                    board = chess.Board(puzzle["fen"])
                    assert key(board) not in seen and puzzle["id"] not in ids, "duplicate"
                    seen.add(key(board))
                    ids.add(puzzle["id"])
                    board.push_uci(puzzle["moves"][0])
                    assert key(board) not in solver_seen, "duplicate solver position"
                    solver_seen.add(key(board))
                    verify_puzzle(puzzle, prober)
                    puzzles.append(puzzle)
        else:
            rng = random.Random(args.seed)
            seen, ids, solver_seen = set(), set(), set()
            counts = Counter()
            weights = [MATERIALS[m] for m in args.materials]
            args.output.parent.mkdir(parents=True, exist_ok=True)
            with args.output.open("w") as output:
                while len(puzzles) < args.count and attempts < args.max_attempts:
                    if time.monotonic() - started >= args.max_seconds:
                        break
                    attempts += 1
                    material = rng.choices(args.materials, weights=weights, k=1)[0]
                    # Prevent the easiest material from consuming the dataset.
                    if counts[material] >= max(10, round(args.count * MATERIALS[material] / sum(weights) * 1.5)):
                        continue
                    board = candidate(material, rng)
                    if board is None:
                        rejected["implausible"] += 1
                        continue
                    try:
                        puzzle = make_puzzle(board, material, prober, rng)
                        before = chess.Board(puzzle["fen"])
                        if key(before) in seen or key(board) in solver_seen or puzzle["id"] in ids:
                            raise Reject("duplicate")
                        verify_puzzle(puzzle, prober)
                    except Reject as exc:
                        rejected[str(exc)] += 1
                        continue
                    seen.add(key(before))
                    solver_seen.add(key(board))
                    ids.add(puzzle["id"])
                    counts[material] += 1
                    puzzles.append(puzzle)
                    output.write(json.dumps(puzzle, separators=(",", ":")) + "\n")
                    output.flush()
                    if len(puzzles) % 25 == 0:
                        print(f"{len(puzzles)}/{args.count} puzzles; {attempts} candidates; "
                              f"{time.monotonic() - started:.1f}s", file=sys.stderr, flush=True)
        report = summarize(puzzles)
        report.update({"seed": args.seed, "attempts": attempts, "rejected": dict(rejected),
                       "wallSeconds": round(time.monotonic() - started, 3),
                       "cpuSeconds": round(time.process_time() - cpu_started, 3),
                       "probes": prober.probes, "verified": len(puzzles),
                       "tablebaseBytes": sum(p.stat().st_size for p in args.tablebases.iterdir() if p.suffix in (".rtbw", ".rtbz"))})
        print(json.dumps(report, indent=2))
        if args.report:
            args.report.write_text(json.dumps(report, indent=2) + "\n")
    if not args.verify_only and len(puzzles) < args.count:
        print("Stopped at the configured budget before reaching the target.", file=sys.stderr)
        raise SystemExit(2)


if __name__ == "__main__":
    main()
