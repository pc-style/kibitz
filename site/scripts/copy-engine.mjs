// Copies the single-threaded lite Stockfish build into public/ so it is served as-is.
// The engine script finds its .wasm next to itself, so both keep their original names, in a folder named
// after the package version: the files are cached for a year, so an upgrade must get new URLs.
import { copyFileSync, mkdirSync, readFileSync, rmSync } from 'node:fs';

const from = new URL('../node_modules/stockfish/', import.meta.url);
// The version pinned in package.json, as vite.config.ts reads it for the engine's URL.
const version = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')).dependencies.stockfish.replace(/[^\d.]/g, '');
const root = new URL('../public/engine/', import.meta.url);
const to = new URL(`${version}/`, root);
rmSync(root, { recursive: true, force: true });
mkdirSync(to, { recursive: true });
for (const file of ['stockfish-19-lite-single.js', 'stockfish-19-lite-single.wasm']) copyFileSync(new URL(`bin/${file}`, from), new URL(file, to));
