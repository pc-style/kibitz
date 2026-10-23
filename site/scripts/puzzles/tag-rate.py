#!/usr/bin/env python3
# /// script
# requires-python = ">=3.11"
# dependencies = ["python-chess==1.999", "numpy>=1.26,<3", "scikit-learn==1.7.2", "scipy>=1.11,<2"]
# ///
"""Add conservative themes and estimated Lichess-scale ratings to original puzzles.

    uv run site/scripts/puzzles/tag-rate.py IN.jsonl OUT.jsonl --engine stockfish
    uv run site/scripts/puzzles/tag-rate.py train lichess.csv.zst --engine stockfish \
        --work /tmp/puzzle-rating --model site/scripts/puzzles/rating-model.json

The first move sets up the puzzle; the solver plays odd-indexed moves. Input
fields survive unchanged except themes, rating, and ratingDeviation. The small
JSON model contains numeric trees, calibration errors, and the allowed themes;
no pickle or executable model is loaded. Training streams the compressed CSV,
uses seeded rating-stratified samples, and writes its evidence to --work.
Stockfish always uses one thread. Run large training jobs through safe-run.
"""

from __future__ import annotations

import argparse
from collections import Counter, defaultdict
import csv
import json
import math
import os
from pathlib import Path
import random
import subprocess
import sys
import tempfile
import time

# Limit native libraries as well as Stockfish on the shared machine.
for variable in ("OMP_NUM_THREADS", "OPENBLAS_NUM_THREADS", "MKL_NUM_THREADS"):
    os.environ[variable] = "1"

import chess
import chess.engine

VERSION = 1
VALUES = {chess.PAWN: 100, chess.KNIGHT: 320, chess.BISHOP: 330,
          chess.ROOK: 500, chess.QUEEN: 900, chess.KING: 20000}
PROBES = {"first_small": 256, "first_large": 2048, "later": 256, "final": 2048}
DEFAULT_MODEL = Path(__file__).with_name("rating-model.json")
RULES = sorted("""mate mateIn1 mateIn2 mateIn3 mateIn4 mateIn5 oneMove short long
veryLong opening middlegame endgame pawnEndgame rookEndgame queenEndgame
bishopEndgame knightEndgame queenRookEndgame promotion underPromotion enPassant
castling fork pin skewer discoveredAttack discoveredCheck doubleCheck hangingPiece sacrifice
trappedPiece attraction deflection quietMove defensiveMove kingsideAttack
queensideAttack exposedKing advancedPawn attackingF2F7 capturingDefender
intermezzo xRayAttack clearance interference backRankMate smotheredMate
anastasiaMate arabianMate bodenMate doubleBishopMate dovetailMate hookMate
advantage crushing equality""".split())


def dump(path, value):
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(value, separators=(",", ":")) + "\n")


def records(path):
    with Path(path).open() as handle:
        for line in handle:
            if line.strip():
                yield json.loads(line)


def material(board, color):
    return sum(len(board.pieces(kind, color)) * VALUES[kind] for kind in range(1, 6))


def score(info, color):
    return max(-2000, min(2000, info["score"].pov(color).score(mate_score=2000)))


def phase(board):
    nonpawns = len(board.piece_map()) - len(board.pieces(chess.PAWN, True)) - len(board.pieces(chess.PAWN, False)) - 2
    if nonpawns <= 6:
        return "endgame"
    if board.fullmove_number <= 10 and nonpawns >= 11:
        return "opening"
    return "middlegame"


def lines(puzzle):
    board = chess.Board(puzzle["fen"])
    if not board.is_valid():
        raise ValueError("invalid starting FEN")
    moves = puzzle["moves"]
    if not isinstance(moves, list) or len(moves) < 2 or len(moves) % 2:
        raise ValueError("moves must have even length >= 2, starting with the opponent")
    result = []
    for uci in moves:
        move = chess.Move.from_uci(uci)
        if move not in board.legal_moves:
            raise ValueError(f"illegal move {uci} in {board.fen()}")
        before = board.copy(stack=False)
        board.push(move)
        result.append((before, move, board.copy(stack=False)))
    return result


def attacked_targets(board, square, enemy):
    return {sq for sq in board.attacks(square)
            if board.color_at(sq) == enemy and board.piece_type_at(sq) != chess.PAWN}


def candidate_tags(line, final_cp):
    solver = line[1][0].turn
    start = line[1][0]
    final = line[-1][2]
    n = len(line) // 2
    tags = {"oneMove" if n == 1 else "short" if n == 2 else "long" if n == 3 else "veryLong", phase(start)}
    if final.is_checkmate():
        tags.add("mate")
        tags.add(f"mateIn{min(n, 5)}")
    else:
        if final_cp >= 850:
            tags.add("crushing")
        elif 220 <= final_cp <= 450:
            tags.add("advantage")
        elif -40 <= final_cp <= 40:
            tags.add("equality")
    kinds = {p.piece_type for p in start.piece_map().values()} - {chess.KING, chess.PAWN}
    endgames = {frozenset(): "pawnEndgame", frozenset({chess.ROOK}): "rookEndgame",
                frozenset({chess.QUEEN}): "queenEndgame", frozenset({chess.BISHOP}): "bishopEndgame",
                frozenset({chess.KNIGHT}): "knightEndgame", frozenset({chess.QUEEN, chess.ROOK}): "queenRookEndgame"}
    if frozenset(kinds) in endgames:
        tags.add(endgames[frozenset(kinds)])
    if "queenRookEndgame" in tags:
        queens = [len(start.pieces(chess.QUEEN, color)) for color in (solver, not solver)]
        rooks = [len(start.pieces(chess.ROOK, color)) for color in (solver, not solver)]
        if (queens, rooks) not in [([1, 0], [0, 2]), ([0, 1], [2, 0])]:
            tags.remove("queenRookEndgame")
    king = start.king(not solver)
    if final.is_checkmate() and len(start.piece_map()) >= 16:
        if chess.square_file(king) >= 6:
            tags.add("kingsideAttack")
        elif chess.square_file(king) <= 2:
            tags.add("queensideAttack")
    if 2 <= chess.square_rank(king) <= 5 and len(start.piece_map()) >= 12:
        if sum(a.is_check() for b, m, a in line[1::2]) >= 2:
            tags.add("exposedKing")
    initial_balance = material(start, solver) - material(start, not solver)
    for index in range(1, len(line), 2):
        before, move, after = line[index]
        kind = before.piece_type_at(move.from_square)
        capture = before.is_capture(move)
        checking = after.is_check()
        future = line[index + 2:]  # Proof of a target being won is stronger than geometry alone.
        future_captures = {m.to_square for b, m, a in future if b.turn == solver and b.is_capture(m)}
        if move.promotion:
            tags.add("promotion")
            if move.promotion != chess.QUEEN:
                tags.add("underPromotion")
        if before.is_en_passant(move):
            tags.add("enPassant")
        if before.is_castling(move):
            tags.add("castling")
        if len(after.checkers()) > 1:
            tags.add("doubleCheck")
        if kind == chess.PAWN:
            rank = chess.square_rank(move.to_square) if solver else 7 - chess.square_rank(move.to_square)
            if rank >= 6 and not move.promotion:
                tags.add("advancedPawn")
        targets = attacked_targets(after, move.to_square, not solver)
        valuable = {sq for sq in targets if after.piece_type_at(sq) == chess.KING
                    or VALUES[after.piece_type_at(sq)] > VALUES[kind]
                    or not after.is_attacked_by(not solver, sq)}
        if len(valuable) >= 2 and future_captures & valuable and not after.is_attacked_by(not solver, move.to_square):
            tags.add("fork")
        for sq in after.pieces(chess.QUEEN, not solver) | after.pieces(chess.ROOK, not solver) | after.pieces(chess.BISHOP, not solver) | after.pieces(chess.KNIGHT, not solver):
            if after.is_pinned(not solver, sq) and not before.is_pinned(not solver, sq) and sq in future_captures:
                tags.add("pin")
        discovered = []
        for sq in after.pieces(chess.BISHOP, solver) | after.pieces(chess.ROOK, solver) | after.pieces(chess.QUEEN, solver):
            if sq == move.to_square or before.piece_at(sq) != after.piece_at(sq):
                continue
            fresh = attacked_targets(after, sq, not solver) - attacked_targets(before, sq, not solver)
            if index + 2 < len(line) and line[index + 2][1].from_square == sq and line[index + 2][1].to_square in fresh & future_captures:
                discovered.append(sq)
        if discovered:
            tags.add("discoveredAttack")
        if kind in (chess.ROOK, chess.BISHOP, chess.QUEEN) and checking and future_captures:
            king = after.king(not solver)
            ray = chess.ray(move.to_square, king)
            if index + 2 < len(line) and line[index + 2][1].from_square == move.to_square and any(
                    chess.BB_SQUARES[sq] & ray and chess.BB_SQUARES[king] & chess.between(move.to_square, sq)
                    and sq == line[index + 2][1].to_square and after.color_at(sq) == (not solver)
                    and (VALUES[after.piece_type_at(sq)] > VALUES[kind] or kind == after.piece_type_at(sq) == chess.QUEEN)
                    for sq in future_captures):
                tags.add("skewer")
        victim = before.piece_type_at(move.to_square)
        if index == 1 and checking and capture and victim and victim != chess.PAWN and not before.is_attacked_by(not solver, move.to_square):
            if not line[0][0].is_capture(line[0][1]) or move.to_square != line[0][1].to_square:
                tags.add("hangingPiece")
        if not capture and not checking and not move.promotion and not before.is_check() and index < len(line) - 1:
            tags.add("quietMove")
        if before.is_check() and not capture and not checking and kind != chess.KING:
            tags.add("defensiveMove")
        if index == 1 and capture and move.to_square == (chess.F7 if solver else chess.F2) and victim == chess.PAWN and before.king(not solver) == (chess.E8 if solver else chess.E1):
            tags.add("attackingF2F7")
        if index + 1 < len(line):
            reply_before, reply, reply_after = line[index + 1]
            if reply.to_square == move.to_square and reply_before.is_capture(reply):
                lost = VALUES[kind] - (VALUES[victim] if victim else 0)
                reply_balance = material(reply_after, solver) - material(reply_after, not solver)
                if lost >= 500 and reply_balance <= initial_balance - 300 and final.is_checkmate():
                    tags.add("sacrifice")
                # The defender is pulled onto the square of the subsequent mating move.
                if checking and reply_before.piece_type_at(reply.from_square) == chess.KING and final.is_checkmate():
                    tags.add("attraction")
            if capture and victim and victim != chess.PAWN:
                for b, m, a in future:
                    if b.turn == solver and b.is_capture(m) and m.to_square in before.attacks(move.to_square):
                        tags.add("capturingDefender")
            if checking and capture and move.to_square != line[index - 1][1].to_square:
                if any(m.to_square == line[index - 1][1].to_square for b, m, a in future if b.turn == solver):
                    tags.add("intermezzo")
            if index + 2 < len(line):
                next_before, next_move, next_after = line[index + 2]
                if next_before.is_capture(next_move):
                    target = next_move.to_square
                    if before.color_at(target) == (not solver) and before.piece_at(reply.from_square):
                        if target in before.attacks(reply.from_square) and target not in reply_after.attacks(reply.to_square):
                            if before.piece_type_at(reply.from_square) != chess.KING and not next_before.is_attacked_by(not solver, target):
                                tags.add("deflection")
                    for defender in before.attackers(not solver, target):
                        if before.piece_type_at(defender) in (chess.BISHOP, chess.ROOK, chess.QUEEN):
                            if chess.BB_SQUARES[move.to_square] & chess.between(defender, target) and not capture:
                                tags.add("interference")
                if next_before.piece_type_at(next_move.from_square) in (chess.BISHOP, chess.ROOK, chess.QUEEN):
                    if chess.BB_SQUARES[move.from_square] & chess.between(next_move.from_square, next_move.to_square):
                        if checking and next_move.from_square != move.to_square:
                            tags.add("clearance")
        if capture and victim in (chess.QUEEN, chess.ROOK) and index > 1:
            earlier = line[index - 2][2]
            if earlier.piece_at(move.to_square) == before.piece_at(move.to_square):
                escape = earlier.copy(stack=False)
                escape.turn = not solver
                safe = [m for m in escape.legal_moves if m.from_square == move.to_square
                        and not escape.is_attacked_by(solver, m.to_square)]
                if not safe:
                    tags.add("trappedPiece")
    if final.is_checkmate():
        king = final.king(not solver)
        kfile, krank = chess.square_file(king), chess.square_rank(king)
        checkers = final.checkers()
        checker_kinds = {final.piece_type_at(sq) for sq in checkers}
        last_rank = 7 if solver else 0
        adjacent = chess.SquareSet(chess.BB_KING_ATTACKS[king])
        if checker_kinds == {chess.KNIGHT} and all(final.color_at(sq) == (not solver) for sq in adjacent):
            tags.add("smotheredMate")
        if krank == last_rank and checker_kinds <= {chess.ROOK, chess.QUEEN}:
            inward = [chess.square(f, krank - 1 if solver else krank + 1) for f in range(max(0, kfile - 1), min(7, kfile + 1) + 1)]
            if all(final.piece_at(sq) == chess.Piece(chess.PAWN, not solver) for sq in inward) and all(chess.square_rank(sq) == krank and chess.square_distance(sq, king) >= 3 for sq in checkers):
                if not any(final.is_pinned(not solver, sq) for sq in chess.SquareSet(final.occupied_co[not solver])):
                    tags.add("backRankMate")
        if checker_kinds == {chess.BISHOP} and len(final.pieces(chess.BISHOP, solver)) == 2:
            bishops = final.pieces(chess.BISHOP, solver)
            if all(final.color_at(sq) == (not solver) or any(sq in final.attacks(b) for b in bishops) for sq in adjacent):
                tags.add("doubleBishopMate")
                if kfile in (2, 3, 4, 5) and krank in (0, 7):
                    tags.add("bodenMate")
        if checker_kinds <= {chess.ROOK, chess.QUEEN}:
            checker = next(iter(checkers))
            for knight in final.pieces(chess.KNIGHT, solver):
                inward_file = kfile + 1 if kfile == 0 else kfile - 1
                if kfile in (0, 7) and chess.square_file(checker) == kfile and abs(chess.square_file(knight) - kfile) == 3 and chess.square_rank(knight) == krank:
                    if final.color_at(chess.square(inward_file, krank)) == (not solver):
                        tags.add("anastasiaMate")
        if checker_kinds == {chess.ROOK}:
            rook = next(iter(checkers))
            for knight in final.pieces(chess.KNIGHT, solver):
                if kfile in (0, 7) and krank in (0, 7) and chess.square_distance(rook, king) == 1 and rook in final.attacks(knight) and abs(chess.square_file(knight)-kfile) == 2 and abs(chess.square_rank(knight)-krank) == 2:
                    tags.add("arabianMate")
                if len(adjacent) == 8 and chess.square_distance(rook, king) == 1 and rook in final.attacks(knight) and any(knight in final.attacks(p) for p in final.pieces(chess.PAWN, solver)):
                    tags.add("hookMate")
        if checker_kinds == {chess.QUEEN}:
            queen = next(iter(checkers))
            if abs(chess.square_file(queen) - kfile) == 1 and abs(chess.square_rank(queen) - krank) == 1:
                geometry = final.copy(stack=False)
                geometry.remove_piece_at(king)
                blocked = [sq for sq in adjacent if sq not in geometry.attacks(queen) and sq != queen]
                if len(adjacent) == 8 and len(blocked) == 2 and all(final.color_at(sq) == (not solver) for sq in blocked) and len(final.attackers(solver, queen)) == 1:
                    tags.add("dovetailMate")
    if any(a.is_check() and a.checkers() != chess.SquareSet([m.to_square])
           and any(sq != m.to_square and b.piece_at(sq) == a.piece_at(sq) for sq in a.checkers())
           for b, m, a in line[1::2]):
        tags.add("discoveredCheck")
        tags.add("discoveredAttack")
    return tags


def extract(puzzle, engine):
    line = lines(puzzle)
    solver = line[1][0].turn
    start = line[1][0]
    # A fresh game clears the transposition table: results do not depend on row order.
    game = object()
    features = {"solver_moves": len(line) // 2, "pieces": len(start.piece_map()),
                "fullmove": start.fullmove_number, "in_check": int(start.is_check()),
                "material": material(start, solver) - material(start, not solver)}
    for kind in range(1, 6):
        features[f"own_{kind}"] = len(start.pieces(kind, solver))
        features[f"other_{kind}"] = len(start.pieces(kind, not solver))
    legals, checks, captures, quiets, found, balances = [], [], [], [], [], []
    for index in range(1, len(line), 2):
        before, move, after = line[index]
        legal = before.legal_moves.count()
        legals.append(legal)
        check = after.is_check()
        capture = before.is_capture(move)
        checks.append(int(check))
        captures.append(int(capture))
        quiets.append(int(not check and not capture))
        balances.append(material(after, solver) - material(after, not solver))
        budget = PROBES["first_small"] if index == 1 else PROBES["later"]
        info = engine.analyse(before, chess.engine.Limit(nodes=budget), game=game)
        hit = int(bool(info.get("pv")) and info["pv"][0] == move)
        found.append(hit)
        if index == 1:
            features["first_small_hit"] = hit
            features["first_small_cp"] = score(info, solver)
            best = engine.analyse(before, chess.engine.Limit(nodes=PROBES["first_large"]), multipv=min(2, legal), game=game)
            features["first_large_hit"] = int(bool(best[0].get("pv")) and best[0]["pv"][0] == move)
            features["first_large_cp"] = score(best[0], solver)
            features["first_gap"] = score(best[0], solver) - score(best[-1], solver)
            features["first_depth"] = best[0].get("depth", 0)
            features["first_capture"] = int(capture)
            features["first_check"] = int(check)
            features["first_piece"] = before.piece_type_at(move.from_square)
    final = line[-1][2]
    if final.is_checkmate():
        final_cp = 2000
    elif final.is_game_over():
        final_cp = 0
    else:
        info = engine.analyse(final, chess.engine.Limit(nodes=PROBES["final"]), game=game)
        final_cp = score(info, solver)
    features.update({"legal_mean": sum(legals) / len(legals), "legal_max": max(legals), "legal_first": legals[0],
                     "checks": sum(checks), "captures": sum(captures), "quiet": sum(quiets),
                     "found_fraction": sum(found) / len(found), "balance_min": min(balances),
                     "balance_gain": balances[-1] - features["material"], "final_cp": final_cp,
                     "mate": int(final.is_checkmate())})
    tags = candidate_tags(line, final_cp)
    for tag in RULES:
        features[f"tag_{tag}"] = int(tag in tags)
    return features, sorted(tags)


def predict(model, features):
    x = [features[name] for name in model["features"]]
    result = model["intercept"]
    for tree in model["trees"]:
        node = tree[0]
        while len(node) > 1:
            feature, threshold, left, right = node
            node = tree[left if x[feature] <= threshold else right]
        result += node[0]
    return int(round(max(model["rating_bounds"][0], min(model["rating_bounds"][1], result))))


def uncertainty(model, features, rating):
    group = "endgame" if features["tag_endgame"] else "other"
    bucket = str(max(0, min(7, rating // 400)))
    value = model["uncertainty"].get(f"{group}:{bucket}", model["uncertainty"]["global"])
    # Human-game training has little support for sparse tablebase positions.
    if features["pieces"] <= 7:
        value = max(value, model["uncertainty"]["sparse_floor"])
    return int(round(value))


def annotate(args):
    model = json.loads(args.model.read_text())
    if model["version"] != VERSION or model["probes"] != PROBES:
        raise ValueError("model and extractor versions do not match")
    if args.input.resolve() == args.output.resolve():
        raise ValueError("input and output must be different files")
    allowed = set(model["allowed_themes"])
    args.output.parent.mkdir(parents=True, exist_ok=True)
    with tempfile.NamedTemporaryFile(prefix=args.output.name + ".", suffix=".partial", dir=args.output.parent, delete=False) as handle:
        temporary = Path(handle.name)
    count = 0
    try:
        with chess.engine.SimpleEngine.popen_uci(args.engine) as engine, temporary.open("w") as output:
            engine.configure({"Threads": 1, "Hash": 16})
            if engine.id.get("name") != model["engine"]:
                print(f"warning: calibrated with {model['engine']}; running {engine.id.get('name')}", file=sys.stderr)
            for count, puzzle in enumerate(records(args.input), 1):
                try:
                    features, tags = extract(puzzle, engine)
                except (ValueError, KeyError, TypeError) as exc:
                    raise ValueError(f"puzzle {count} ({puzzle.get('id', 'no id')}): {exc}") from exc
                puzzle["themes"] = sorted(set(puzzle.get("themes", [])) | (set(tags) & allowed))
                puzzle["rating"] = predict(model, features)
                puzzle["ratingDeviation"] = uncertainty(model, features, puzzle["rating"])
                output.write(json.dumps(puzzle, separators=(",", ":")) + "\n")
        temporary.replace(args.output)
    except BaseException:
        temporary.unlink(missing_ok=True)
        raise
    print(json.dumps({"output": str(args.output), "puzzles": count}), file=sys.stderr)


def sample_csv(args):
    rng = random.Random(args.seed)
    reservoirs = defaultdict(list)
    seen = Counter()
    vocabulary = Counter()
    started = time.monotonic()
    capacity = math.ceil((args.train_size + args.calibration_size + args.test_size) / 4)
    process = subprocess.Popen(["zstd", "-dc", str(args.csv)], stdout=subprocess.PIPE, text=True)
    try:
        for row in csv.DictReader(process.stdout):
            vocabulary.update(row["Themes"].split())
            if int(row["NbPlays"]) < 1000 or int(row["RatingDeviation"]) > 80:
                continue
            bucket = min(8, max(0, int(row["Rating"]) // 400))
            seen[bucket] += 1
            if len(reservoirs[bucket]) < capacity:
                reservoirs[bucket].append(row)
            else:
                j = rng.randrange(seen[bucket])
                if j < capacity:
                    reservoirs[bucket][j] = row
    finally:
        process.stdout.close()
        if process.wait() != 0:
            raise RuntimeError("zstd failed")
    queues = {}
    positions = set()
    for bucket, rows in sorted(reservoirs.items()):
        rng.shuffle(rows)
        queues[bucket] = []
        for row in rows:
            board = chess.Board(row["FEN"])
            board.push_uci(row["Moves"].split()[0])
            key = " ".join(board.fen().split()[:4])
            if key in positions:
                continue
            positions.add(key)
            queues[bucket].append(row)
    selected = []
    total = args.train_size + args.calibration_size + args.test_size
    while len(selected) < total:
        before = len(selected)
        for bucket in sorted(queues):
            if queues[bucket] and len(selected) < total:
                selected.append(queues[bucket].pop())
        if before == len(selected):
            raise ValueError("not enough eligible distinct positions")
    rng.shuffle(selected)
    counts = Counter()
    with (args.work / "sample.jsonl").open("w") as handle:
        for index, row in enumerate(selected):
            split = "train" if index < args.train_size else "calibration" if index < args.train_size + args.calibration_size else "test"
            puzzle = {"id": row["PuzzleId"], "fen": row["FEN"], "moves": row["Moves"].split(),
                      "true_themes": row["Themes"].split(), "true_rating": int(row["Rating"]), "split": split,
                      "nbPlays": int(row["NbPlays"]), "true_rd": int(row["RatingDeviation"])}
            handle.write(json.dumps(puzzle, separators=(",", ":")) + "\n")
            counts[f"{split}:{int(row['Rating']) // 400}"] += 1
    dump(args.work / "sampling.json", {"seed": args.seed, "eligible_by_bucket": seen, "sample_by_bucket": counts,
                                       "vocabulary": vocabulary, "seconds": time.monotonic() - started})


def precision_table(rows, vocabulary):
    actual, predicted, correct = Counter(), Counter(), Counter()
    for row in rows:
        truth, tags = set(row["true_themes"]), set(row["candidate_tags"])
        actual.update(truth)
        predicted.update(tags)
        correct.update(truth & tags)
    return {tag: {"actual": actual[tag], "predicted": predicted[tag], "tp": correct[tag],
                  "precision": correct[tag] / predicted[tag] if predicted[tag] else None,
                  "recall": correct[tag] / actual[tag] if actual[tag] else None}
            for tag in sorted(set(vocabulary) | set(RULES))}


def regression_metrics(y, prediction):
    import numpy as np
    from scipy.stats import spearmanr
    y, prediction = np.asarray(y), np.asarray(prediction)
    return {"n": len(y), "mae": float(np.mean(abs(y - prediction))),
            "rmse": float(np.sqrt(np.mean((y - prediction)**2))),
            "bias_predicted_minus_actual": float(np.mean(prediction-y)),
            "spearman": float(spearmanr(y, prediction).statistic) if len(set(prediction)) > 1 else None}


def fit_model(args):
    import numpy as np
    from sklearn.ensemble import HistGradientBoostingRegressor
    rows = list(records(args.work / "features.jsonl"))
    if args.refresh_rules:
        for row in rows:
            tags = candidate_tags(lines(row), row["features"]["final_cp"])
            row["candidate_tags"] = sorted(tags)
            for tag in RULES:
                row["features"][f"tag_{tag}"] = int(tag in tags)
        replacement = args.work / "features.refreshed.jsonl"
        with replacement.open("w") as handle:
            for row in rows:
                handle.write(json.dumps(row, separators=(",", ":")) + "\n")
        replacement.replace(args.work / "features.jsonl")
    splits = {split: [r for r in rows if r["split"] == split] for split in ("train", "calibration", "test")}
    sampling = json.loads((args.work / "sampling.json").read_text())
    calibration = precision_table(splits["calibration"], sampling["vocabulary"])
    holdout = precision_table(splits["test"], sampling["vocabulary"])
    mechanical = {"castling", "enPassant", "promotion", "underPromotion", "doubleCheck", "mateIn5"}
    rare_patterns = {"anastasiaMate", "arabianMate", "smotheredMate", "hookMate"}
    allowed = [tag for tag in RULES if (
        calibration[tag]["predicted"] >= 20 and calibration[tag]["precision"] >= 0.85
        and holdout[tag]["predicted"] >= 20 and holdout[tag]["precision"] >= 0.85
    ) or (tag in mechanical and calibration[tag]["precision"] == 1 and holdout[tag]["precision"] == 1)
      or (tag in rare_patterns and calibration[tag]["predicted"] >= 5 and calibration[tag]["precision"] >= 0.95
          and holdout[tag]["predicted"] >= 20 and holdout[tag]["precision"] >= 0.85)]
    names = sorted(rows[0]["features"])
    matrices = {split: np.array([[r["features"][name] for name in names] for r in group]) for split, group in splits.items()}
    ratings = {split: np.array([r["true_rating"] for r in group]) for split, group in splits.items()}
    regressor = HistGradientBoostingRegressor(max_iter=220, max_leaf_nodes=15, learning_rate=0.08,
                                            min_samples_leaf=40, l2_regularization=8,
                                            early_stopping=True, random_state=args.seed)
    regressor.fit(matrices["train"], ratings["train"])
    trees = []
    for iteration in regressor._predictors:
        tree = []
        for node in iteration[0].nodes:
            if node["is_leaf"]:
                tree.append([round(float(node["value"]), 7)])
            else:
                tree.append([int(node["feature_idx"]), float(node["num_threshold"]), int(node["left"]), int(node["right"])])
        trees.append(tree)
    model = {"version": VERSION, "probes": PROBES, "engine": json.loads((args.work / "engine.json").read_text())["name"],
             "seed": args.seed, "features": names, "intercept": float(regressor._baseline_prediction[0][0]),
             "trees": trees, "rating_bounds": [400, 3500], "allowed_themes": allowed,
             "uncertainty": {}, "training_rows": len(splits["train"]),
             "data": {"source": "Lichess puzzle database", "license": "CC0", "minimum_plays": 1000,
                      "maximum_source_deviation": 80, "rating_strata_width": 400,
                      "position_disjoint": True, "calibration_rows": len(splits["calibration"]),
                      "test_rows": len(splits["test"])},
             "uncertainty_method": "calibration RMSE by predicted rating bucket and phase; minimum 350 for <=7 pieces"}
    predictions = {split: np.array([predict(model, r["features"]) for r in group]) for split, group in splits.items()}
    # Compare the exported evaluator against sklearn rather than trusting its internal schema.
    exported_difference = max(abs(predictions["test"] - np.clip(regressor.predict(matrices["test"]), 400, 3500)))
    if exported_difference > 0.501:
        raise AssertionError(f"JSON tree predictions differ by {exported_difference}")
    errors = defaultdict(list)
    for row, prediction in zip(splits["calibration"], predictions["calibration"]):
        group = "endgame" if row["features"]["tag_endgame"] else "other"
        bucket = max(0, min(7, int(prediction) // 400))
        error = int(prediction) - row["true_rating"]
        errors[f"{group}:{bucket}"].append(error)
        errors["global"].append(error)
        if row["features"]["pieces"] <= 7:
            errors["sparse_floor"].append(error)
    for key, values in errors.items():
        if len(values) >= 50:
            model["uncertainty"][key] = round(float(np.sqrt(np.mean(np.square(values)))))
    model["uncertainty"]["sparse_floor"] = max(350, model["uncertainty"].get("sparse_floor", model["uncertainty"]["global"]))
    mean = float(np.mean(ratings["train"]))
    length_ratings = defaultdict(list)
    for row in splits["train"]:
        length_ratings[row["features"]["solver_moves"]].append(row["true_rating"])
    length_means = {n: float(np.mean(values)) for n, values in length_ratings.items()}
    baseline_length = [length_means.get(r["features"]["solver_moves"], mean) for r in splits["test"]]
    metrics = {"model": regression_metrics(ratings["test"], predictions["test"]),
               "mean_baseline": regression_metrics(ratings["test"], [mean] * len(splits["test"])),
               "length_baseline": regression_metrics(ratings["test"], baseline_length)}
    for label, predicate in {"lichess_endgames": lambda r: "endgame" in r["true_themes"],
                             "sparse_7_pieces": lambda r: r["features"]["pieces"] <= 7,
                             "one_to_five_solver_moves": lambda r: r["features"]["solver_moves"] <= 5,
                             "non_endgames": lambda r: "endgame" not in r["true_themes"]}.items():
        indices = [i for i, r in enumerate(splits["test"]) if predicate(r)]
        if indices:
            metrics[label] = regression_metrics(ratings["test"][indices], predictions["test"][indices])
    model["validation"] = metrics
    dump(args.model, model)
    if args.model.stat().st_size >= 1_000_000:
        raise AssertionError("model exceeds 1 MB")
    dropped = {}
    for tag, metric in holdout.items():
        if tag in allowed:
            continue
        if not metric["predicted"]:
            reason = "no supported rule or no positive examples; not shipped"
        elif calibration[tag]["predicted"] < 20 or metric["predicted"] < 20:
            reason = "fewer than 20 predictions in calibration or test; insufficient evidence"
        elif calibration[tag]["precision"] < 0.85:
            reason = "calibration precision below 0.85"
        else:
            reason = "holdout precision below 0.85"
        dropped[tag] = reason
    report = {"metrics": metrics, "allowed_themes": allowed, "dropped_themes": dropped,
              "theme_holdout": holdout, "theme_calibration": calibration,
              "sample_sizes": {split: len(group) for split, group in splits.items()},
              "export_max_difference": float(exported_difference), "model_bytes": args.model.stat().st_size,
              "probes": PROBES, "uncertainty": model["uncertainty"],
              "rating_range": {split: [int(min(values)), int(max(values))] for split, values in ratings.items()},
              "counts_by_length": {split: dict(Counter(r["features"]["solver_moves"] for r in group)) for split, group in splits.items()},
              "theme_selection": "Empirical precision >=0.85 on both calibration and test with >=20 predictions in each; rare mate patterns need >=5 calibration predictions at >=0.95 and >=20 test predictions. Exact special moves and mateIn5 may pass with fewer examples when both precisions are 1. These are point estimates, not 95% confidence guarantees. Final test precision gates shipping, so tag allow-list selection is not independent of the reported test.",
              "bias_notes": ["Rating-stratified evaluation is not population-weighted; ratings cover the well-played eligible range.",
                             "Human-game tactics may differ from bot blunders and composed/tablebase endgames; original ratings have no human-play validation.",
                             "Sparse positions receive an uncertainty floor, not an invented rating correction.",
                             "Node-limited Stockfish probes measure engine search difficulty imperfectly and can miss long tactical ideas.",
                             "Lichess tags are incomplete; measured precision is agreement with its labels."]}
    dump(args.work / "report.json", report)
    with (args.work / "theme-metrics.csv").open("w") as handle:
        writer = csv.writer(handle)
        writer.writerow(["theme", "shipped", "actual", "predicted", "tp", "precision", "recall", "drop_reason"])
        for tag, metric in holdout.items():
            writer.writerow([tag, tag in allowed, *metric.values(), dropped.get(tag, "")])
    with (args.work / "sample-50.jsonl").open("w") as sample, (args.work / "sample-50-truth.jsonl").open("w") as truth:
        for row in [r for r in splits["test"] if r["features"]["solver_moves"] <= 5][:50]:
            sample.write(json.dumps({"fen": row["fen"], "moves": row["moves"]}) + "\n")
            truth.write(json.dumps({k: row[k] for k in ("id", "true_rating", "true_themes")}) + "\n")
    print(json.dumps(report["metrics"], indent=2), flush=True)
    print(f"Allowed themes ({len(allowed)}): {' '.join(allowed)}", flush=True)


def train(args):
    args.work.mkdir(parents=True, exist_ok=True)
    config = {"seed": args.seed, "train_size": args.train_size, "calibration_size": args.calibration_size,
              "test_size": args.test_size, "csv": str(args.csv.resolve()), "version": VERSION, "probes": PROBES}
    config_path = args.work / "config.json"
    if config_path.exists() and json.loads(config_path.read_text()) != config:
        raise ValueError("work directory belongs to a different training configuration")
    dump(config_path, config)
    started = time.monotonic()
    if not (args.work / "sample.jsonl").exists():
        sample_csv(args)
    if args.sample_only:
        return
    cached = args.work / "features.jsonl"
    done = set()
    if cached.exists():
        done = {row["id"] for row in records(cached)}
    with chess.engine.SimpleEngine.popen_uci(args.engine) as engine, cached.open("a") as output:
        engine.configure({"Threads": 1, "Hash": 16})
        dump(args.work / "engine.json", engine.id)
        for index, puzzle in enumerate(records(args.work / "sample.jsonl"), 1):
            if puzzle["id"] in done:
                continue
            features, tags = extract(puzzle, engine)
            puzzle["features"], puzzle["candidate_tags"] = features, tags
            output.write(json.dumps(puzzle, separators=(",", ":")) + "\n")
            if index % 250 == 0:
                output.flush()
                print(f"features {index}: {time.monotonic() - started:.1f}s", flush=True)
    fit_model(args)
    dump(args.work / "timing.json", {"wall_seconds": time.monotonic() - started,
                                     "python_cpu_seconds": time.process_time()})


def main():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    if len(sys.argv) > 1 and sys.argv[1] == "train":
        parser.add_argument("command")
        parser.add_argument("csv", type=Path)
        parser.add_argument("--work", type=Path, required=True)
        parser.add_argument("--engine", default="stockfish")
        parser.add_argument("--model", type=Path, default=DEFAULT_MODEL)
        parser.add_argument("--seed", type=int, default=20261023)
        parser.add_argument("--train-size", type=int, default=35000)
        parser.add_argument("--calibration-size", type=int, default=10000)
        parser.add_argument("--test-size", type=int, default=20000)
        parser.add_argument("--sample-only", action="store_true")
        parser.add_argument("--refresh-rules", action="store_true", help="recompute geometry tags from cached engine features before fitting")
        args = parser.parse_args()
        if min(args.train_size, args.calibration_size, args.test_size) < 1:
            parser.error("sample sizes must be positive")
        train(args)
    else:
        parser.add_argument("input", type=Path)
        parser.add_argument("output", type=Path)
        parser.add_argument("--engine", default="stockfish")
        parser.add_argument("--model", type=Path, default=DEFAULT_MODEL)
        annotate(parser.parse_args())


if __name__ == "__main__":
    main()
