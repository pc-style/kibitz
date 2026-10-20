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

## Themes
Four themes share one set of roles (`[data-theme]` on `<html>`, set before first paint from localStorage, falling back to the system light/dark preference):
- **Felt** (default): green-black, brass accent, green board.
- **Walnut:** warm dark brown, copper accent, maple and walnut board.
- **Midnight:** blue slate, cyan accent, blue board.
- **Paper:** light, ink-blue accent, gray-blue board. Grade colors darken so they stay readable as text on white.

Each swatch carries its own `data-theme`, so it previews that theme's board without duplicated color values. `--page-*` captures the page's colors for rings drawn around swatches.

## Color (OKLCH, Felt shown)
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
- Motion tokens: 120 / 180 / 320ms, one decelerating curve. Everything is disabled under `prefers-reduced-motion` (CSS plus the JS checks).

## Motion (each one reports a change)
| Where | What it says |
| --- | --- |
| Grade badge pops on the played square; best-move arrow fades in 110ms later | the verdict, then the alternative |
| Comment card crossfades and tints by grade | the explanation changed, and how good the move was |
| Eval bar scales; graph cursor glides | where the game stands and where you are in it |
| Graph draws in from the left; markers pop as the line reaches them | the game's story, in order |
| Grade counts roll up when they change | analysis just found something |
| Accuracy counts up when the review completes | the review is done |
| Progress sheen (only while the engine works) | work is actually happening |
| Games list rows stagger in | new results arrived |
| Theme reveal spreads from the pressed swatch; pages crossfade | cause and continuity |

## Craft decisions
- **Layout:** home is an asymmetric 5/7 split with a sticky headline. The review screen gives the board the largest share, with a fixed-width side panel (summary, comment, moves, controls). On phones it becomes one column ordered for stepping through: board, verdict, controls, then graph, turning points, summary and moves.
- **Review flow:** progress lives in the summary while the engine runs; accuracy shows player names; turning points under the graph jump to the brilliant moves and biggest swings.
- **Components:** buttons, fields, the segmented control, grade counts, and move cells all have hover, active, focus-visible, and disabled states. Grade counts jump to the next move with that grade.
- **Accessibility:** visible focus ring in the accent color, keyboard navigation (arrows, Home/End, F to flip), labelled controls, a live progress region, and 24px-plus targets.

## Slop audit (v0.2)
No Inter/Roboto, no purple or indigo, no gradient text, no glassmorphism, no stacked border plus diffuse shadow, no cream background, no hero with three feature cards, no hover lifts or looping decoration. The structure follows the tool's job (input, then board and review), not a landing-page template. Checked in headless Chrome at 1440×900 and 390×844 in all four themes.
