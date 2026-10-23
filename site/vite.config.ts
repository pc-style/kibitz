import { defineConfig } from 'vite';
import preact from '@preact/preset-vite';
import pkg from './package.json';

// scripts/copy-engine.mjs puts Stockfish under public/engine/<version>/, the version pinned in package.json.
const engine = pkg.dependencies.stockfish.replace(/[^\d.]/g, '');

// The opening book is a lazy chunk of ~110 kB gzipped; don't warn about it. Sounds and puzzle files stay files,
// fetched only when needed, rather than small ones being inlined into the main script.
export default defineConfig({
  plugins: [preact()],
  define: { __ENGINE_VERSION__: JSON.stringify(engine) },
  build: { chunkSizeWarningLimit: 1000, assetsInlineLimit: (file) => (file.endsWith('.mp3') || file.includes('/puzzles/data/') ? false : undefined) },
});
