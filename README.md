# Kibitz

Free chess in the browser: lessons from zero, bots, games with friends over a link, and game review. Every reviewed move gets a chess.com-style grade (brilliant to blunder), both players get an accuracy score, and a coach explains what went wrong, with Best and Retry to learn from it. Stockfish 19 runs on your own device, so there's no paywall and no daily limit.

**Live:** https://kibitz.pcstyle.dev

## Use it

- Load recent games by chess.com or lichess username, or paste a PGN.
- Play a bot from Play; a game left half-way is kept in your browser and comes back when you return.
- To play a friend, open Play → A friend, make a link and send it. No accounts; rooms close after 15 minutes without a move.
- Every board you play on also takes typed moves (e4, Nf3, e2e4): Tab to the field under the board.
- Sounds for moves, captures, checks, lessons and game endings come in four sets (Wood, Marble, Chime, 8-bit); switch them, or turn sound off, under the gear.
- On chess.com, the extension in [`extension/`](extension) adds a **Free review** button to finished games. Load it in Chrome with `chrome://extensions` → Developer mode → Load unpacked. It refuses games still in progress.

## Develop

```sh
cd site
pnpm install
pnpm dev     # copies the engine into public/engine, then starts Vite
pnpm build   # copies the engine, type-checks, builds to dist/
npx convex dev   # games with friends: runs the backend in site/convex against your own Convex dev deployment
pnpm sounds  # resynthesizes every sound into src/sounds (needs uv and ffmpeg)
```

Production builds on Vercel run `npx convex deploy` first when `CONVEX_DEPLOY_KEY` is set (see `site/vercel.json`), so the backend and the site ship together.

Grade thresholds and accuracy live in `site/src/review.ts`, the coach's wording in `site/src/explain.ts`, and the engine pool in `site/src/engine.ts`.

## Credits and license

GPL-3.0-or-later (see `LICENSE`), since Stockfish and chessground are GPL.

- Engine: [Stockfish](https://stockfishchess.org) via [stockfish.js](https://github.com/nmrugg/stockfish.js) (GPL-3.0)
- Board: [chessground](https://github.com/lichess-org/chessground) (GPL-3.0), moves: [chess.js](https://github.com/jhlywa/chess.js) (BSD-2)
- Opening names: [lichess-org/chess-openings](https://github.com/lichess-org/chess-openings) (CC0)
- Accuracy formula: lichess; grade categories: chess.com
- Piece sets: see [`site/public/pieces/LICENSES.md`](site/public/pieces/LICENSES.md)
- Sounds: synthesized from scratch by [`site/scripts/make-sounds.py`](site/scripts/make-sounds.py), no recordings
