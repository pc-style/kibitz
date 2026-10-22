// Kibitz: puts a "Free review" button on finished chess.com games and opens them on the Kibitz site.

const SITE = 'https://kibitz-review.vercel.app/';

// /game/live/123, /game/daily/123, /analysis/game/live/123, /live/game/123, /game/123
const GAME_PATH = /^\/(?:analysis\/)?(?:game\/(live|daily)\/(\d+)|(live|daily)\/game\/(\d+)|game\/(\d+))(?:[/?#]|$)/;

// chess.com stores moves as TCN: two characters per move, one per square.
const TCN = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789!?{~}(^)[_]@#$,./&-*++=';
const square = (i) => 'abcdefgh'[i % 8] + (Math.floor(i / 8) + 1);

function decodeTcn(tcn) {
  const moves = [];
  for (let i = 0; i < tcn.length; i += 2) {
    const from = TCN.indexOf(tcn[i]);
    let to = TCN.indexOf(tcn[i + 1]);
    if (from > 63) throw new Error("Variant games with piece drops aren't supported.");
    let promotion = '';
    if (to > 63) {
      // Promotion: the code holds the piece and the capture direction.
      promotion = 'qnrb'[Math.floor((to - 64) / 3)];
      to = from + (from < 16 ? -8 : 8) + ((to - 1) % 3) - 1;
    }
    moves.push(square(from) + square(to) + promotion);
  }
  return moves;
}

function currentGame() {
  const m = GAME_PATH.exec(location.pathname);
  if (!m) return null;
  const type = m[1] || m[3];
  return { id: m[2] || m[4] || m[5], types: type ? [type] : ['live', 'daily'] };
}

async function fetchGame({ id, types }) {
  for (const type of types) {
    const res = await fetch(`/callback/${type}/game/${id}`, { credentials: 'include' });
    if (res.ok) return res.json();
  }
  throw new Error("chess.com didn't return this game.");
}

function toReviewUrl(data) {
  const { game, players } = data;
  if (!game.isFinished) throw new Error('Finish the game first. Kibitz only reviews finished games.');
  if (game.typeName && game.typeName !== 'Standard Chess') throw new Error(`${game.typeName} isn't supported yet.`);

  const headers = { ...game.pgnHeaders };
  if (game.initialSetup) Object.assign(headers, { SetUp: '1', FEN: game.initialSetup });
  const tags = Object.entries(headers)
    .map(([k, v]) => `[${k} "${String(v).replace(/"/g, "'")}"]`)
    .join('\n');
  const pgn = `${tags}\n\n${decodeTcn(game.moveList).join(' ')} ${headers.Result || '*'}`;

  // chess.com puts your own side at the bottom, so keep that view.
  const params = new URLSearchParams({ pgn });
  if (players?.bottom?.color === 'black') params.set('o', 'b');
  return `${SITE}#${params}`;
}

let button = null;

function render() {
  const game = currentGame();
  if (!game) {
    button?.remove();
    button = null;
    return;
  }
  if (button?.isConnected) return;
  button = document.createElement('button');
  button.type = 'button';
  button.className = 'kibitz-review';
  button.textContent = 'Free review';
  button.title = 'Open a free move-by-move review on Kibitz';
  button.addEventListener('click', onClick);
  document.body.append(button);
}

async function onClick(event) {
  // This button, not the module-level one: chess.com may navigate and replace it while the game loads.
  const el = event.currentTarget;
  const game = currentGame();
  if (!game || el.disabled) return;
  // Open the tab inside the click so popup blockers allow it, then point it at the review.
  const tab = window.open('about:blank', '_blank');
  el.disabled = true;
  el.textContent = 'Opening…';
  try {
    const url = toReviewUrl(await fetchGame(game));
    if (tab) {
      tab.opener = null;
      tab.location.href = url;
    } else {
      location.href = url;
    }
    el.textContent = 'Free review';
  } catch (err) {
    tab?.close();
    el.textContent = err instanceof Error ? err.message : String(err);
    setTimeout(() => (el.textContent = 'Free review'), 4000);
  } finally {
    el.disabled = false;
  }
}

// chess.com navigates without page loads, so re-check the URL as it changes.
render();
let lastPath = location.pathname;
setInterval(() => {
  if (location.pathname !== lastPath) {
    lastPath = location.pathname;
    render();
  }
}, 800);
