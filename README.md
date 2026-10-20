# Kibitz

Free chess game review in the browser. Every move gets a chess.com-style grade (brilliant to blunder), both players get an accuracy score, and a coach explains what went wrong, with Best and Retry to learn from it. Stockfish 19 runs on your own device, so there's no paywall and no daily limit.

**Live:** https://kibitz-review.vercel.app

## Use it

- Load recent games by chess.com or lichess username, or paste a PGN.
- On chess.com, the extension in [`extension/`](extension) adds a **Free review** button to finished games. Load it in Chrome with `chrome://extensions` → Developer mode → Load unpacked. It refuses games still in progress.

## Develop

```sh
cd site
pnpm install
pnpm dev     # copies the engine into public/engine, then starts Vite
pnpm build   # copies the engine, type-checks, builds to dist/
```

Grade thresholds and accuracy live in `site/src/review.ts`, the coach's wording in `site/src/explain.ts`, and the engine pool in `site/src/engine.ts`.

## Credits and license

GPL-3.0-or-later (see `LICENSE`), since Stockfish and chessground are GPL.

- Engine: [Stockfish](https://stockfishchess.org) via [stockfish.js](https://github.com/nmrugg/stockfish.js) (GPL-3.0)
- Board: [chessground](https://github.com/lichess-org/chessground) (GPL-3.0), moves: [chess.js](https://github.com/jhlywa/chess.js) (BSD-2)
- Opening names: [lichess-org/chess-openings](https://github.com/lichess-org/chess-openings) (CC0)
- Accuracy formula: lichess; grade categories: chess.com
- Piece sets: see [`site/public/pieces/LICENSES.md`](site/public/pieces/LICENSES.md)
