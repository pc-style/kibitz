// Copies the single-threaded lite Stockfish build into public/ so it is served as-is.
// The engine script finds its .wasm next to itself, so both keep their original names.
import { copyFileSync, mkdirSync } from 'node:fs';

const from = new URL('../node_modules/stockfish/bin/', import.meta.url);
const to = new URL('../public/engine/', import.meta.url);
mkdirSync(to, { recursive: true });
for (const file of ['stockfish-19-lite-single.js', 'stockfish-19-lite-single.wasm']) copyFileSync(new URL(file, from), new URL(file, to));
