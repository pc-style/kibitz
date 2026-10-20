# Kibitz design

## Discovery
- **Artifact:** a single-purpose analysis tool (home page plus a review screen). Not a marketing site.
- **Audience:** club players who want chess.com-style game review without paying for it; the first users are developers who prefer open tools.
- **Primary action:** get a game in front of the review in one step (username list, pasted PGN, or the chess.com extension).
- **Adjectives:** studious, candid, quick, analog. **Essence:** annotated scoresheet, nocturnal.

## Aesthetic and signature
Printed chess literature (Informator glyphs, scoresheet columns) in a dark analysis room. Green-black felt tones, an off-white ink line, one brass accent.
**Signature move:** the eval graph under the board. White's winning chances are drawn as a solid ink area, and notable moves are marked where they happened, so the turning points read at a glance and a click jumps there.

## Typography
- Display and UI: Schibsted Grotesk (400/500/700).
- Notation, numbers, and glyphs: Martian Mono (400/600).
- Scale: 1.2 ratio on a 15px base (12.5, 14, 15, 18, 21.6, fluid display).

## Color (OKLCH, dark only)
| Role | Value |
| --- | --- |
| bg | `oklch(0.17 0.012 165)` |
| surface / surface-2 | `oklch(0.205 0.014 165)` / `oklch(0.25 0.016 165)` |
| border | `oklch(0.32 0.016 165)` |
| fg / muted | `oklch(0.94 0.008 110)` / `oklch(0.73 0.02 150)` |
| accent / accent-fg | `oklch(0.84 0.15 88)` / `oklch(0.22 0.03 88)` |
| error | `oklch(0.72 0.16 25)` |
| board squares | `oklch(0.83 0.035 125)` / `oklch(0.57 0.055 150)` |

Grade colors follow chess.com's conventions so they read instantly (teal brilliant, blue great, greens for best to good, yellow, orange, and red for inaccuracy through blunder). Every grade also has a glyph and a written label, so color is never the only signal.

## Tokens and rules
- Spacing base 4px; tight inside groups, wider between panels.
- Radii: 4px (controls) and 8px (panels). No shadows in the app; edges come from borders and lightness steps. The extension button is the one exception, since it floats over chess.com.
- Motion: 150-240ms ease-out on transform/opacity and color only; disabled under `prefers-reduced-motion`.

## Craft decisions
- **Layout:** home is an asymmetric 5/7 split with a sticky headline. The review screen gives the board the largest share, with a fixed-width side panel (summary, comment, moves, controls). It stacks below 900px.
- **Components:** buttons, fields, the segmented control, grade counts, and move cells all have hover, active, focus-visible, and disabled states. Grade counts jump to the next move with that grade.
- **Accessibility:** visible focus ring in the accent color, keyboard navigation (arrows, Home/End, F to flip), labelled controls, a live progress region, and 24px-plus targets.

## Slop audit (v0.1)
No Inter/Roboto, no purple or indigo, no gradient text, no glassmorphism, no stacked border plus diffuse shadow, no cream background, no hero with three feature cards. The structure follows the tool's job (input, then board and review), not a landing-page template. Not yet checked in a rendered browser.
