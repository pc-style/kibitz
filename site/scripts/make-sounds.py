#!/usr/bin/env python3
# /// script
# requires-python = ">=3.10"
# dependencies = ["numpy>=1.26", "scipy>=1.11"]
# ///
"""
Synthesizes every sound Kibitz plays. Nothing here is a recording.

The board sounds are modal physics: a piece's contact with the board sets ringing the resonances of the piece,
the board and the table under it, and a small room adds its reflections. The tunes are played on instruments
built the same way (a marimba bar, a vibraphone bar, a celesta plate) or on an emulated NES sound chip.

Every set has the same sounds, so the site can switch between them freely:

    move, capture, check, castle, promote   on the board; move and capture come in a few takes, so a run of
                                            moves doesn't sound like a machine gun
    start, win, lose, draw                  a game beginning and ending
    notify, lowtime                         a friend's offer or rematch, your clock running low
    correct, wrong, star                    lessons; the site pitches star up the scale as stars are collected

From site/:   pnpm sounds          (uv run scripts/make-sounds.py; needs ffmpeg with libmp3lame)
              pnpm sounds --wav /tmp/kibitz-wav    also writes WAV copies, for listening or plotting

Writes src/sounds/<set>/<sound>[-<take>].mp3. Every random choice is seeded, so a rerun makes the same sounds.
"""

from __future__ import annotations

import argparse
import math
import os
import shutil
import subprocess
import sys
import zlib
from pathlib import Path
from typing import Callable

import numpy as np
from scipy.signal import butter, fftconvolve, lfilter, resample_poly, sosfilt

SR = 48_000
OUT = Path(__file__).resolve().parent.parent / "src" / "sounds"
TAU = 2 * math.pi
LN1000 = math.log(1000)  # over a T60, a ringing falls by 60 dB: a factor of 1000 in amplitude

Signal = np.ndarray


# ---------------------------------------------------------------- basics


def samples(seconds: float) -> int:
    return int(round(seconds * SR))


def clock(seconds: float) -> Signal:
    return np.arange(max(1, samples(seconds))) / SR


def decay(t: Signal, t60: float) -> Signal:
    return np.exp(-LN1000 * t / t60)


def note(name: str) -> float:
    """'A4' -> 440 Hz, 'C#6' -> 1108.7 Hz."""
    names = "C C# D D# E F F# G G# A A# B".split()
    return 440.0 * 2 ** ((names.index(name[:-1]) - 9) / 12 + int(name[-1]) - 4)


def mix(*parts: tuple[float, Signal, float]) -> Signal:
    """(start in seconds, signal, gain) parts laid over each other, as one signal long enough for all of them."""
    end = max(samples(at) + len(sig) for at, sig, _ in parts)
    out = np.zeros(end)
    for at, sig, gain in parts:
        i = samples(at)
        out[i : i + len(sig)] += gain * sig
    return out


def lowpass(x: Signal, hz: float, order: int = 2) -> Signal:
    return sosfilt(butter(order, min(hz, SR * 0.45), "lowpass", fs=SR, output="sos"), x)


def highpass(x: Signal, hz: float, order: int = 2) -> Signal:
    return sosfilt(butter(order, hz, "highpass", fs=SR, output="sos"), x)


def bandpass(x: Signal, lo: float, hi: float, order: int = 2) -> Signal:
    return sosfilt(butter(order, [lo, min(hi, SR * 0.45)], "bandpass", fs=SR, output="sos"), x)


# ---------------------------------------------------------------- physics of a struck object


def modes(freqs, amps, t60s, seconds: float) -> Signal:
    """A struck object ringing: a decaying sine at each of its resonant frequencies (its modes), all from rest."""
    t = clock(seconds)
    out = np.zeros_like(t)
    for f, a, d in zip(freqs, amps, t60s):
        if 20 < f < SR * 0.45:
            out += a * decay(t, d) * np.sin(TAU * f * t)
    return out


def mode_cloud(rng, lo: float, hi: float, count: int, t60_lo: float, t60_hi: float, tilt_db: float, seconds: float) -> Signal:
    """
    Many weak modes spread over a band: the dense, slightly noisy resonance that makes a real solid sound solid
    rather than like a few sine waves. Where the object is hit decides how strongly each mode rings, so the
    strengths are random; higher modes lose energy faster, so their T60 slides from t60_lo down to t60_hi.
    """
    f = np.exp(rng.uniform(math.log(lo), math.log(hi), count))
    at = (np.log(f) - math.log(lo)) / (math.log(hi) - math.log(lo))
    amps = rng.rayleigh(1.0, count) * 10 ** (tilt_db * np.log2(f / lo) / 20) / math.sqrt(count)
    t60s = np.exp(math.log(t60_lo) + at * (math.log(t60_hi) - math.log(t60_lo))) * rng.uniform(0.75, 1.3, count)
    return modes(f, amps, t60s, seconds)


def strike(ir: Signal, contact_ms: float) -> Signal:
    """
    Excites a resonance with a contact that lasts contact_ms. The force rises and falls like half a sine, and a
    short contact (stone on stone) reaches high modes that a long one (felt, a yarn mallet) smooths away.
    """
    n = max(2, samples(contact_ms / 1000))
    force = np.sin(np.pi * (np.arange(n) + 0.5) / n)
    return fftconvolve(ir, force / force.sum())[: len(ir)]


def burst(rng, seconds: float, lo: float, hi: float, t60: float) -> Signal:
    """Band-limited noise dying away fast: the scrape and crack of a contact, which no set of modes captures."""
    t = clock(seconds)
    return bandpass(rng.standard_normal(len(t)), lo, hi) * decay(t, t60)


def mallet(f: float, hardness: float) -> float:
    """How much of a mode at f a mallet brings out. A harder mallet (higher hardness, in Hz) reaches further up."""
    return 1 / (1 + (f / hardness) ** 2)


def room(rng, x: Signal, wet: float = 0.16, rt60: float = 0.22, size: float = 1.0, damp: float = 5000) -> Signal:
    """
    Puts a dry sound in a small, furnished room: reflections off the table and nearby walls in the first
    25 ms or so, then a soft diffuse tail whose highs die out before its lows.
    """
    length = samples(rt60 * 1.25 + 0.03 * size)
    ir = np.zeros(length)
    for ms, gain in zip((1.9, 3.4, 5.3, 7.9, 10.8, 14.6, 19.3, 25.7), (0.55, 0.45, 0.36, 0.29, 0.23, 0.18, 0.14, 0.1)):
        ir[samples(ms * size / 1000)] += gain * rng.choice((-1.0, 1.0))
    start = samples(0.008 * size)
    t = clock((length - start) / SR)
    noise = rng.standard_normal(len(t))
    tail = lowpass(noise, 800) * decay(t, rt60) + highpass(noise, 800) * decay(t, rt60 * 0.45)
    ir[start:] += 0.03 * tail[: length - start]
    ir = lowpass(ir, damp)
    ir /= np.sqrt(np.sum(ir**2))
    out = fftconvolve(x, ir) * wet
    out[: len(x)] += x
    return out


# ---------------------------------------------------------------- pieces on boards


def wood_knock(rng, weight: float = 1.0, hard: float = 1.0, pitch: float = 1.0) -> Signal:
    """
    A weighted boxwood piece set down on a wooden board. Three resonators share one contact: the piece (small,
    stiff, high modes gone within a few tens of ms), the board (a wooden panel, lower and longer), and the table
    beneath it (a short low thump that gives a heavy piece its weight).
    """
    seconds = 0.3
    j = lambda: rng.uniform(0.97, 1.03)  # noqa: E731
    piece = mode_cloud(rng, 1500 * pitch, 7500 * pitch, 26, 0.05, 0.012, -3.0, seconds)
    piece += modes([2150 * pitch * j(), 3380 * pitch * j()], [0.9 * rng.uniform(0.6, 1), 0.5 * rng.uniform(0.6, 1)], [0.045, 0.03], seconds)
    board_f = np.array([212, 351, 486, 642, 803, 1037, 1290]) * pitch ** 0.3
    board = modes(board_f * rng.uniform(0.96, 1.04, 7), rng.uniform(0.35, 1.0, 7) * [1, 0.9, 0.8, 0.7, 0.55, 0.45, 0.35], [0.13, 0.12, 0.1, 0.085, 0.07, 0.06, 0.05], seconds)
    board += mode_cloud(rng, 400, 1800, 18, 0.09, 0.04, -2.0, seconds)
    table = modes([88 * j(), 136 * j()], [1.0, 0.5], [0.055, 0.04], seconds)
    ir = 0.55 * piece + 0.85 * board + 0.6 * weight * table
    x = strike(ir, 0.34 / hard)
    x += 0.035 * hard * np.pad(burst(rng, 0.008, 2200, 11000, 0.003), (0, len(x)))[: len(x)]
    return x


def stone_knock(rng, weight: float = 1.0, hard: float = 1.0, pitch: float = 1.0) -> Signal:
    """
    A polished stone piece on a marble board: a harder, glassier contact than wood, high piece modes that ring
    a little longer (stone loses less energy than wood), and a slab that answers higher and brighter.
    """
    seconds = 0.4
    j = lambda: rng.uniform(0.97, 1.03)  # noqa: E731
    piece = mode_cloud(rng, 2600 * pitch, 11000 * pitch, 30, 0.1, 0.03, -2.5, seconds)
    piece += modes([3150 * pitch * j(), 4870 * pitch * j(), 6930 * pitch * j()], [0.8, 0.45, 0.25], [0.11, 0.07, 0.045], seconds)
    slab_f = np.array([610, 935, 1340, 1820, 2390, 3060]) * pitch ** 0.3
    slab = modes(slab_f * rng.uniform(0.97, 1.03, 6), rng.uniform(0.35, 1.0, 6) * [0.8, 1, 0.85, 0.7, 0.5, 0.35], [0.17, 0.15, 0.13, 0.11, 0.09, 0.07], seconds)
    slab += mode_cloud(rng, 700, 3200, 20, 0.16, 0.07, -1.5, seconds)
    table = modes([118 * j()], [0.6], [0.035], seconds)
    ir = 0.5 * piece + 0.65 * slab + 0.45 * weight * table
    x = strike(ir, 0.16 / hard)
    x += 0.03 * hard * np.pad(burst(rng, 0.006, 3500, 14000, 0.0025), (0, len(x)))[: len(x)]
    return x


def clack(rng, knock: Callable, pitch: float) -> Signal:
    """Piece on piece: the capturing piece hitting the one it takes. Mostly the two pieces' own high modes."""
    seconds = 0.2
    lo = 1700 if knock is wood_knock else 2800
    a = mode_cloud(rng, lo * pitch, lo * 4.6 * pitch, 24, 0.045 if knock is wood_knock else 0.08, 0.012, -2.0, seconds)
    b = mode_cloud(rng, lo * 1.12 * pitch, lo * 5 * pitch, 24, 0.04 if knock is wood_knock else 0.07, 0.01, -2.0, seconds)
    x = strike(a + b, 0.12)
    x += 0.06 * np.pad(burst(rng, 0.006, 2500, 12000, 0.002), (0, len(x)))[: len(x)]
    return x


# ---------------------------------------------------------------- instruments


def marimba(rng, f: float, vel: float = 1.0, damp: float = 1.0) -> Signal:
    """
    A rosewood marimba bar over its tube. Its overtones are tuned two octaves and about three octaves and a
    third up; a yarn mallet softens them, and the tube keeps the fundamental singing a little after the strike.
    """
    ring = min(1.1, 0.85 * (523.25 / f) ** 0.55) * damp
    ratios, amps = (1.0, 3.98, 9.86, 17.3), (1.0, 0.38, 0.12, 0.04)
    hardness = 2000 + 2600 * vel
    seconds = ring * 1.05 + 0.05
    x = modes([r * f for r in ratios], [a * mallet(r * f, hardness) for r, a in zip(ratios, amps)], [ring, ring * 0.3, ring * 0.12, ring * 0.06], seconds)
    t = clock(seconds)
    x += 0.22 * (1 - np.exp(-t / 0.025)) * decay(t, ring * 1.15) * np.sin(TAU * f * t + 0.6)  # the tube's bloom
    x *= 1 - np.exp(-t / 0.0006)  # the mallet's contact rounds the very start
    x += 0.05 * vel * np.pad(burst(rng, 0.012, 500, 3500, 0.006), (0, len(x)))[: len(x)]
    return vel * x


def vibraphone(rng, f: float, vel: float = 1.0, damp: float = 1.0) -> Signal:
    """
    An aluminium vibraphone bar: a long, pure fundamental, overtones at four and ten times that fade fast, a
    bright metallic strike, and the slow shimmer of the motor's fans turning in the tubes.
    """
    ring = min(1.5, 1.8 * (523.25 / f) ** 0.4) * damp
    ratios, amps = (1.0, 4.0, 10.02, 16.6), (1.0, 0.28, 0.08, 0.025)
    hardness = 2600 + 3400 * vel
    seconds = ring * 1.05 + 0.05
    x = modes([r * f for r in ratios], [a * mallet(r * f, hardness) for r, a in zip(ratios, amps)], [ring, ring * 0.22, ring * 0.08, ring * 0.04], seconds)
    t = clock(seconds)
    x *= 1 + 0.1 * np.sin(TAU * 5.2 * t - math.pi / 2)  # tremolo, starting from its quiet point
    x *= 1 - np.exp(-t / 0.0004)
    x += 0.03 * vel * np.pad(burst(rng, 0.006, 3000, 12000, 0.003), (0, len(x)))[: len(x)]
    return vel * x


def celesta(rng, f: float, vel: float = 1.0, damp: float = 1.0) -> Signal:
    """
    A celesta: felt hammers on steel plates over wooden resonators. A sweet, nearly pure tone with a faint
    octave, a glassy shimmer of inharmonic partials that is gone in a tenth of a second, and a twin a hair out
    of tune, which gives the plate's gentle beating.
    """
    ring = min(1.4, 1.2 * (1046.5 / f) ** 0.5) * damp
    parts = ((1.0, 1.0, ring), (1.0017, 0.32, ring * 0.9), (2.0, 0.16, ring * 0.45), (3.01, 0.05, ring * 0.2), (5.43, 0.12, 0.07), (8.94, 0.07, 0.04), (13.3, 0.035, 0.025))
    hardness = 4500 + 3500 * vel
    seconds = ring * 1.05 + 0.05
    x = modes([r * f for r, _, _ in parts], [a * mallet(r * f, hardness) for r, a, _ in parts], [d for _, _, d in parts], seconds)
    t = clock(seconds)
    x *= 1 - np.exp(-t / 0.0005)
    x += 0.025 * vel * np.pad(burst(rng, 0.005, 2000, 9000, 0.003), (0, len(x)))[: len(x)]
    return vel * x


def woodblock(rng, f: float, vel: float = 1.0) -> Signal:
    """A hollow temple block hit with a hard stick: one strong, short resonance over a few woody partials."""
    scale = (700 / f) ** 0.3
    ratios, amps = (1.0, 1.52, 2.31, 3.47, 4.9), (1.0, 0.3, 0.2, 0.1, 0.05)
    ir = modes([r * f for r in ratios], amps, [0.17 * scale, 0.08 * scale, 0.05, 0.03, 0.02], 0.35)
    ir += 0.25 * mode_cloud(rng, f * 1.2, f * 8, 16, 0.05, 0.01, -3.0, 0.35)
    x = strike(ir, 0.2)
    x += 0.08 * np.pad(burst(rng, 0.004, 2000, 10000, 0.002), (0, len(x)))[: len(x)]
    return vel * x


def glass(rng, f: float, vel: float = 1.0) -> Signal:
    """A crystal glass flicked with a fingernail: two close modes that beat slowly, high, clear and short."""
    parts = ((1.0, 1.0, 0.5), (1.0026, 0.7, 0.48), (2.32, 0.28, 0.2), (4.25, 0.1, 0.09), (6.6, 0.04, 0.05))
    ir = modes([r * f for r, _, _ in parts], [a for _, a, _ in parts], [d for _, _, d in parts], 0.6)
    x = strike(ir, 0.08)
    x += 0.04 * np.pad(burst(rng, 0.004, 4000, 15000, 0.002), (0, len(x)))[: len(x)]
    return vel * x


# ---------------------------------------------------------------- an NES sound chip

CPU = 1_789_773  # the NTSC console's clock, which every channel's pitch is divided down from
OVER = 4  # rendered at four times the sample rate, then filtered down, so high notes don't alias harshly
FS = SR * OVER
DUTY = (np.array([0, 1, 0, 0, 0, 0, 0, 0]), np.array([0, 1, 1, 0, 0, 0, 0, 0]), np.array([0, 1, 1, 1, 1, 0, 0, 0]))  # 12.5, 25, 50 %
TRIANGLE = np.concatenate([np.arange(15, -1, -1), np.arange(16)])
NOISE_PERIODS = (4, 8, 16, 32, 64, 96, 128, 160, 202, 254, 380, 508, 762, 1016, 2034, 4068)


def _lfsr() -> np.ndarray:
    """The noise channel's 15-bit shift register, run through its whole 32767-step cycle."""
    out, reg = np.empty(32767), 1
    for i in range(32767):
        out[i] = reg & 1
        reg = (reg >> 1) | (((reg ^ (reg >> 1)) & 1) << 14)
    return out


LFSR = _lfsr()


class Chip:
    """A stretch of NES audio, written note by note into its pulse, triangle and noise channels, then mixed
    through the console's non-linear DAC and output filters."""

    def __init__(self, seconds: float):
        n = int(seconds * FS)
        self.pulse, self.tri, self.noise = np.zeros(n), np.zeros(n), np.zeros(n)

    @staticmethod
    def _span(at: float, seconds: float):
        return int(at * FS), np.arange(int(seconds * FS)) / FS

    @staticmethod
    def _volume(t: Signal, vol: int, fade: int | None) -> Signal:
        """
        The 4-bit volume. With fade, the hardware envelope: one step down every (fade + 1) / 240 s. The chip
        starts and stops notes instantly, which pops; a third of a millisecond in and two out keep it clean.
        """
        level = np.full(len(t), float(vol)) if fade is None else np.maximum(vol - np.floor(t * 240 / (fade + 1)), 0)
        return level * np.clip(t / 0.0003, 0, 1) * np.clip((t[-1] - t) / 0.002, 0, 1)

    def square(self, at: float, seconds: float, f: float, duty: int = 2, vol: int = 12, fade: int | None = 1, bend: Callable[[Signal], Signal] | None = None, vibrato: float = 0.0):
        i, t = self._span(at, seconds)
        freq = f * (bend(t) if bend else 1.0) * (1 + vibrato * np.sin(TAU * 6 * t))
        period = np.maximum(np.round(CPU / (16 * freq) - 1), 8)  # pitch is an 11-bit divider, so it moves in steps
        phase = np.cumsum(CPU / (16 * (period + 1)) / FS)
        wave = DUTY[duty][(np.floor(phase * 8) % 8).astype(int)]
        self.pulse[i : i + len(t)] += wave * self._volume(t, vol, fade)

    def triangle(self, at: float, seconds: float, f: float):
        i, t = self._span(at, seconds)
        period = np.round(CPU / (32 * f) - 1)
        phase = t * CPU / (32 * (period + 1))
        self.tri[i : i + len(t)] += TRIANGLE[(np.floor(phase * 32) % 32).astype(int)] * self._volume(t, 1, None)

    def hiss(self, at: float, seconds: float, rate: int, vol: int = 12, fade: int | None = 0):
        """Noise at one of the chip's sixteen rates (0 is the highest hiss, 15 a low rumble)."""
        i, t = self._span(at, seconds)
        steps = np.floor(t * CPU / NOISE_PERIODS[rate]).astype(int) % len(LFSR)
        self.noise[i : i + len(t)] += LFSR[steps] * self._volume(t, vol, fade)

    def render(self) -> Signal:
        pulse = np.where(self.pulse > 0, 95.88 / (8128 / np.maximum(self.pulse, 1e-9) + 100), 0.0)
        tnd = self.tri / 8227 + self.noise / 12241
        tnd = np.where(tnd > 0, 159.79 / (1 / np.maximum(tnd, 1e-12) + 100), 0.0)
        x = pulse + tnd
        # The console's output stage: a high-pass that removes the DC offset, and a gentle low-pass.
        b, a = butter(1, 90, "highpass", fs=FS)
        x = lfilter(b, a, x)
        b, a = butter(1, 14000, "lowpass", fs=FS)
        x = lfilter(b, a, x)
        return resample_poly(x, 1, OVER)


def chip_note(rng, f: float, vel: float = 1.0, damp: float = 1.0) -> Signal:
    """One plucked chip note: a 25 % pulse, a touch of vibrato, and the envelope fading it out. Low notes go to the triangle."""
    seconds = 0.42 * damp
    chip = Chip(seconds + 0.02)
    if f < 260:
        chip.triangle(0, seconds * 0.8, f)
    else:
        chip.square(0, seconds, f, duty=1, vol=round(13 * vel), fade=max(0, round(3 * damp) - 1), vibrato=0.004)
    return chip.render()


# ---------------------------------------------------------------- tunes

# (start in seconds, note, velocity, [damp]) for each tune, played on a set's instrument.
Tune = list[tuple]

TUNES: dict[str, Tune] = {
    # A rising fourth onto a major third: here we go.
    "start": [(0.0, "D5", 0.75), (0.1, "G5", 0.95), (0.1, "B5", 0.5)],
    # An arpeggio up to the octave, landing on the full chord.
    "win": [(0.0, "C5", 0.8), (0.075, "E5", 0.85), (0.15, "G5", 0.9), (0.23, "C6", 1.0), (0.23, "G5", 0.45), (0.23, "E5", 0.4), (0.23, "C4", 0.55)],
    # Down through A minor, slower and softer: it's only a game.
    "lose": [(0.0, "E5", 0.7), (0.16, "C5", 0.65), (0.34, "A4", 0.75), (0.34, "E4", 0.4)],
    # An open fifth: neither major nor minor.
    "draw": [(0.0, "G5", 0.7), (0.13, "C5", 0.65), (0.13, "G5", 0.45)],
    "notify": [(0.0, "A5", 0.7), (0.075, "E6", 0.75)],
    "correct": [(0.0, "C6", 0.7), (0.085, "E6", 0.85)],
    # Down a semitone, damped: not that one.
    "wrong": [(0.0, "E4", 0.8, 0.45), (0.12, "D#4", 0.7, 0.45)],
    "star": [(0.0, "G6", 0.8), (0.0, "G5", 0.25)],
}


def play(rng, tune: Tune, inst: Callable) -> Signal:
    return mix(*[(at, inst(rng, note(n), v, *(rest or [1.0])), 1.0) for at, n, v, *rest in tune])


# ---------------------------------------------------------------- the sets


class Set:
    name: str
    takes = {"move": 4, "capture": 3}

    def sound(self, rng, name: str, take: int) -> Signal:
        raise NotImplementedError


class Physical(Set):
    """Real pieces on a real board (wood or stone), with the tunes on a matching instrument."""

    def __init__(self, name: str, knock: Callable, inst: Callable, accent: Callable, accent_hz: tuple[float, float], space: dict):
        self.name, self.knock, self.inst, self.accent, self.accent_hz, self.space = name, knock, inst, accent, accent_hz, space

    def sound(self, rng, name: str, take: int) -> Signal:
        knock, hi, lo = self.knock, *self.accent_hz
        pitch = lambda: rng.uniform(0.94, 1.06)  # noqa: E731  each piece, and each spot on the board, rings a little differently
        if name == "move":
            x = knock(rng, weight=rng.uniform(0.85, 1.1), hard=rng.uniform(0.9, 1.1), pitch=pitch())
        elif name == "capture":
            # The capturing piece knocks into the other, lands a moment later, and the taken piece is set aside.
            x = mix((0, clack(rng, knock, pitch()), 1.0), (0.021, knock(rng, weight=1.15, hard=1.2, pitch=pitch()), 0.85), (0.07, knock(rng, weight=0.2, hard=0.8, pitch=1.25), 0.16))
        elif name == "castle":
            # King, then rook (a broader piece, so a little lower).
            x = mix((0, knock(rng, weight=1.1, pitch=1.0), 1.0), (0.11, knock(rng, weight=1.0, pitch=0.9), 0.85))
        elif name == "check":
            x = mix((0, knock(rng, weight=1.1, hard=1.2, pitch=pitch()), 1.0), (0.012, self.accent(rng, hi * 0.66), 0.6))
        elif name == "promote":
            x = mix((0, knock(rng, weight=1.0, pitch=pitch()), 1.0), (0.05, self.inst(rng, note("G5"), 0.6), 0.3), (0.13, self.inst(rng, note("D6"), 0.75), 0.32))
        elif name == "lowtime":
            # A clock's tick and tock.
            x = mix((0, self.accent(rng, hi), 1.0), (0.16, self.accent(rng, lo), 0.8))
        else:
            x = play(rng, TUNES[name], self.inst)
        return room(rng, x, **self.space)


class Chime(Set):
    """
    Musical moves on a celesta: each move a note of the pentatonic scale, so a game plays a slow, aimless tune;
    captures lower and doubled, checks a tense tritone.
    """

    name = "chime"
    takes = {"move": 5, "capture": 3}
    SCALE = ("C6", "D6", "E6", "G6", "A6")

    def sound(self, rng, name: str, take: int) -> Signal:
        tick = lambda: 0.35 * wood_knock(rng, weight=0.0, hard=0.8, pitch=1.3)  # noqa: E731  a faint tap of the piece, so a move still lands
        if name == "move":
            x = mix((0, tick(), 1.0), (0, celesta(rng, note(self.SCALE[take - 1]), 0.7), 0.9))
        elif name == "capture":
            low, high = (("A5", "E6"), ("G5", "D6"), ("C6", "G6"))[take - 1]
            x = mix((0, tick(), 1.4), (0, celesta(rng, note(low), 0.85), 0.8), (0, celesta(rng, note(high), 0.7), 0.55), (0, celesta(rng, note(low) / 2, 0.6), 0.45))
        elif name == "check":
            x = mix((0, tick(), 1.0), (0, celesta(rng, note("C#6"), 0.85), 0.75), (0.035, celesta(rng, note("G6"), 0.9), 0.75))
        elif name == "castle":
            x = mix((0, tick(), 1.0), (0, celesta(rng, note("C6"), 0.7), 0.85), (0.11, tick(), 1.0), (0.11, celesta(rng, note("G6"), 0.75), 0.85))
        elif name == "promote":
            x = mix((0, tick(), 1.0), *[(i * 0.045, celesta(rng, note(n), 0.6 + 0.08 * i), 0.7) for i, n in enumerate(("C6", "E6", "G6", "C7"))])
        elif name == "lowtime":
            x = mix((0, celesta(rng, note("E7"), 0.8, 0.5), 1.0), (0.16, celesta(rng, note("B6"), 0.75, 0.5), 0.9))
        else:
            x = play(rng, TUNES[name], celesta)
        return room(rng, x, wet=0.22, rt60=0.45, size=1.6, damp=6000)


class Retro(Set):
    """An 8-bit console: square-wave blips, noise for the impacts, and the tunes as chip melodies."""

    name = "retro"
    takes = {"move": 3, "capture": 3}

    def sound(self, rng, name: str, take: int) -> Signal:
        down = lambda depth, rate: (lambda t: 1 - depth * (1 - np.exp(-t * rate)))  # noqa: E731  a pitch drop that eases out
        chip = Chip(1.0)
        if name == "move":
            f = (880, 831, 932)[take - 1]
            chip.hiss(0, 0.03, rate=4, vol=5, fade=0)
            chip.square(0, 0.06, f, duty=1, vol=12, fade=0, bend=down(0.5, 50))
        elif name == "capture":
            f = (440, 415, 466)[take - 1]
            chip.hiss(0, 0.12, rate=7, vol=13, fade=1)
            chip.square(0, 0.1, f, duty=1, vol=13, fade=0, bend=down(0.7, 30))
        elif name == "check":
            chip.hiss(0, 0.03, rate=3, vol=6, fade=0)
            for at in (0, 0.075):
                chip.square(at, 0.055, note("E6"), duty=2, vol=11, fade=None)
                chip.square(at, 0.055, note("B6"), duty=0, vol=6, fade=None)
        elif name == "castle":
            for at, n in ((0, "G5"), (0.1, "C6")):
                chip.hiss(at, 0.035, rate=3, vol=7, fade=0)
                chip.square(at, 0.07, note(n), duty=1, vol=11, fade=0)
        elif name == "promote":
            chip.hiss(0, 0.035, rate=3, vol=7, fade=0)
            for i, n in enumerate(("C5", "E5", "G5", "C6", "E6", "G6", "C7")):
                chip.square(i * 0.028, 0.03 if i < 6 else 0.16, note(n), duty=1, vol=10, fade=None if i < 6 else 1)
        elif name == "lowtime":
            for at in (0, 0.16):
                chip.square(at, 0.07, note("A6"), duty=2, vol=10, fade=None)
        elif name == "wrong":
            chip.square(0, 0.24, 196, duty=2, vol=11, fade=2, bend=down(0.25, 8))
            chip.square(0, 0.24, 98, duty=2, vol=8, fade=2, bend=down(0.25, 8))
        elif name == "win":
            # The fanfare gets its own chip arrangement: lead, harmony a third below, and a triangle bass.
            for at, n in ((0, "C5"), (0.075, "E5"), (0.15, "G5")):
                chip.square(at, 0.07, note(n), duty=2, vol=11, fade=None)
            chip.square(0.23, 0.5, note("C6"), duty=2, vol=12, fade=3, vibrato=0.006)
            chip.square(0.23, 0.5, note("E5"), duty=1, vol=8, fade=3)
            chip.triangle(0.23, 0.32, note("C4"))
        else:
            return play(rng, TUNES[name], chip_note)
        x = chip.render()
        return x


SETS: list[Set] = [
    Physical("wood", wood_knock, marimba, woodblock, (1150.0, 860.0), dict(wet=0.16, rt60=0.22)),
    Physical("marble", stone_knock, vibraphone, glass, (2350.0, 1760.0), dict(wet=0.2, rt60=0.32, size=1.3, damp=6500)),
    Chime(),
    Retro(),
]

NAMES = ("move", "capture", "check", "castle", "promote", "start", "win", "lose", "draw", "notify", "lowtime", "correct", "wrong", "star")

# How loud each sound should be: the loudest 100 ms, K-weighted (LUFS, as broadcast meters measure).
# Moves sit in the middle; the alerts a little above, the tunes a little below, since a ringing note sounds
# louder than a knock that measures the same. A knock's first millisecond is a sharp crack, so this is about as
# loud as it gets before the limiter has to blunt it.
LOUDNESS = {
    "move": -22.0, "capture": -20.5, "check": -20.0, "castle": -22.0, "promote": -21.5,
    "start": -23.5, "win": -22.5, "lose": -24.0, "draw": -24.0, "notify": -22.5, "lowtime": -20.5,
    "correct": -24.0, "wrong": -25.0, "star": -25.5,
}  # fmt: skip
# Sustained sounds carry further than knocks at the same level: celesta notes ring on, square waves never decay.
SET_TRIM = {"chime": -1.5, "retro": -2.5}

# ---------------------------------------------------------------- mastering

# ITU-R BS.1770 K-weighting at 48 kHz: a high shelf for the head, a high-pass for the ear's weak low end.
K_WEIGHT = (
    ([1.53512485958697, -2.69169618940638, 1.19839281085285], [1.0, -1.69065929318241, 0.73248077421585]),
    ([1.0, -2.0, 1.0], [1.0, -1.99004745483398, 0.99007225036621]),
)


def loudness(x: Signal, window: float = 0.1) -> float:
    y = x
    for b, a in K_WEIGHT:
        y = lfilter(b, a, y)
    w = min(samples(window), len(y))
    power = np.convolve(y**2, np.ones(w) / w, "valid")
    return -0.691 + 10 * math.log10(max(float(power.max()), 1e-12))


def soft_limit(x: Signal, ceiling: float, knee: float = 0.7) -> Signal:
    """Leaves everything below knee x ceiling alone and rounds the peaks above it into the ceiling."""
    k = ceiling * knee
    a = np.abs(x)
    over = a > k
    y = x.copy()
    y[over] = np.sign(x[over]) * (k + (ceiling - k) * np.tanh((a[over] - k) / (ceiling - k)))
    return y


def master(x: Signal, target: float, peak_db: float = -2.5, floor_db: float = -60.0, longest: float = 2.2) -> tuple[Signal, float]:
    """Cleans up the low end, trims the inaudible tail, sets the loudness and keeps peaks under the ceiling.
    The ceiling leaves room for MP3 encoding, which overshoots sharp peaks by a dB or so, and for a few sounds
    overlapping. Returns the sound and how many dB the limiter took off its loudest peak."""
    x = highpass(x, 40)
    x = x[: samples(longest)]
    level = np.abs(x)
    end = int(np.nonzero(level > level.max() * 10 ** (floor_db / 20))[0][-1]) + 1
    x = x[:end].copy()
    fade = min(samples(0.03), len(x) // 3)
    x[-fade:] *= np.cos(np.linspace(0, math.pi / 2, fade)) ** 2
    x *= 10 ** ((target - loudness(x)) / 20)
    ceiling = 10 ** (peak_db / 20)
    peak = float(np.abs(x).max())
    x = soft_limit(x, ceiling)
    return x, max(0.0, 20 * math.log10(peak / float(np.abs(x).max())))


def encode(path: Path, x: Signal, rng, ffmpeg: str):
    """16-bit with a whisper of triangular dither, then VBR MP3, which every browser decodes."""
    dither = (rng.random(len(x)) - rng.random(len(x))) / 32768
    pcm = np.clip(np.round((x + dither) * 32767), -32768, 32767).astype("<i2")
    cmd = [ffmpeg, "-hide_banner", "-loglevel", "error", "-y", "-f", "s16le", "-ar", str(SR), "-ac", "1", "-i", "pipe:0"]
    cmd += ["-c:a", "libmp3lame", "-q:a", "2", "-map_metadata", "-1", "-fflags", "+bitexact", "-flags:a", "+bitexact", "-id3v2_version", "0", str(path)]
    subprocess.run(cmd, input=pcm.tobytes(), check=True)


def write_wav(path: Path, x: Signal):
    import wave

    with wave.open(str(path), "wb") as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(SR)
        w.writeframes(np.clip(np.round(x * 32767), -32768, 32767).astype("<i2").tobytes())


def main():
    parser = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    parser.add_argument("--wav", type=Path, help="also write WAV copies here")
    parser.add_argument("--only", help="just this set")
    args = parser.parse_args()
    ffmpeg = os.environ.get("FFMPEG") or shutil.which("ffmpeg")
    if not ffmpeg:
        sys.exit("ffmpeg is needed (with libmp3lame) to encode the sounds.")

    for s in SETS:
        if args.only and s.name != args.only:
            continue
        folder = OUT / s.name
        shutil.rmtree(folder, ignore_errors=True)
        folder.mkdir(parents=True)
        if args.wav:
            (args.wav / s.name).mkdir(parents=True, exist_ok=True)
        for name in NAMES:
            takes = s.takes.get(name, 1)
            for take in range(1, takes + 1):
                file = name if takes == 1 else f"{name}-{take}"
                rng = np.random.default_rng(zlib.crc32(f"{s.name}/{file}".encode()))
                x, limited = master(s.sound(rng, name, take), LOUDNESS[name] + SET_TRIM.get(s.name, 0.0))
                encode(folder / f"{file}.mp3", x, rng, ffmpeg)
                if args.wav:
                    write_wav(args.wav / s.name / f"{file}.wav", x)
                size = (folder / f"{file}.mp3").stat().st_size
                print(f"{s.name:7} {file:10} {len(x) / SR:5.2f} s  {size / 1024:5.1f} kB  limiter {limited:4.1f} dB")


if __name__ == "__main__":
    main()
