import { defineConfig } from 'vite';
import preact from '@preact/preset-vite';

// The opening book is a lazy chunk of ~110 kB gzipped; don't warn about it.
export default defineConfig({ plugins: [preact()], build: { chunkSizeWarningLimit: 1000 } });
