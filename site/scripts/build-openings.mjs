// Builds src/openings.json from lichess-org/chess-openings (CC0).
// Every position along a named line counts as book; named positions also carry the opening name.
import { writeFileSync } from 'node:fs';
import { Chess } from 'chess.js';

const base = 'https://raw.githubusercontent.com/lichess-org/chess-openings/master/';
const epd = (fen) => fen.split(' ').slice(0, 4).join(' ');

const book = new Set();
const names = {};
for (const file of ['a', 'b', 'c', 'd', 'e']) {
  const tsv = await (await fetch(`${base}${file}.tsv`)).text();
  for (const row of tsv.trim().split('\n').slice(1)) {
    const [eco, name, pgn] = row.split('\t');
    const chess = new Chess();
    chess.loadPgn(pgn);
    for (const move of chess.history({ verbose: true })) book.add(epd(move.after));
    names[epd(chess.fen())] = `${eco} ${name}`;
  }
}
writeFileSync(new URL('../src/openings.json', import.meta.url), JSON.stringify({ book: [...book], names }));
console.log(`${book.size} book positions, ${Object.keys(names).length} names`);
