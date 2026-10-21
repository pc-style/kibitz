import { useState } from 'preact/hooks';
import { TIME_CONTROLS } from '../../convex/timeControls';
import { onlineAvailable, player, roomHash, setPlayerName } from './player';
import './online.css';

type ColorChoice = 'white' | 'random' | 'black';

/** The Play page's "A friend" panel: a name, a time mode and a color, then a link to send. */
export function FriendSetup() {
  const [name, setName] = useState(player().name);
  const [clock, setClock] = useState('10+0');
  const [color, setColor] = useState<ColorChoice>('random');
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string>();

  const create = async (e: Event) => {
    e.preventDefault();
    setBusy(true);
    setProblem(undefined);
    setPlayerName(name);
    // The game server's client loads only when a room is made.
    const { rooms, errorText } = await import('./client');
    try {
      const code = await rooms.create({ token: player().token, name, clock, color });
      location.hash = roomHash(code);
    } catch (err) {
      setProblem(errorText(err));
      setBusy(false);
    }
  };

  if (!onlineAvailable) return <p class="play-note">Online play isn’t set up on this copy of Kibitz.</p>;
  return (
    <form class="online-setup" onSubmit={create}>
      <label class="field">
        <span>Your name</span>
        <input value={name} maxLength={20} onInput={(e) => setName(e.currentTarget.value)} placeholder="Player" autocomplete="nickname" spellcheck={false} />
      </label>
      <fieldset>
        <legend>Time</legend>
        <TimeChoices value={clock} onPick={setClock} name="new-clock" />
      </fieldset>
      <fieldset class="play-colors">
        <legend>You play</legend>
        <div class="play-color-options">
          {(['white', 'random', 'black'] as const).map((c) => (
            <label class="play-color" key={c}>
              <input type="radio" name="friend-color" checked={color === c} onChange={() => setColor(c)} />
              <span>{c === 'white' ? 'White' : c === 'black' ? 'Black' : 'Random'}</span>
            </label>
          ))}
        </div>
      </fieldset>
      <button type="submit" class="button button-primary play-start" disabled={busy}>
        {busy ? 'Making the room…' : 'Create a game link'}
      </button>
      {problem ? (
        <p class="form-error" role="alert">
          {problem}
        </p>
      ) : null}
      <p class="play-note">No accounts. Send the link, and your friend joins with one tap. Rooms close after 15 minutes without a move.</p>
    </form>
  );
}

export function TimeChoices({ value, onPick, name }: { value: string; onPick: (id: string) => void; name: string }) {
  return (
    <div class="online-time-grid">
      {TIME_CONTROLS.map((t) => (
        <label key={t.id} class="online-time">
          <input type="radio" name={name} checked={value === t.id} onChange={() => onPick(t.id)} />
          <strong>{t.id === 'none' ? '∞' : t.id}</strong>
          <span>{t.label}</span>
        </label>
      ))}
    </div>
  );
}
