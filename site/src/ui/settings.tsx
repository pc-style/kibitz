import { DEPTHS, PIECE_SETS, THEMES, updateSettings, useSettings, type Settings } from '../settings';
import { applyTheme } from './theme';

const TOGGLES: { key: keyof Pick<Settings, 'coordinates' | 'evalBar' | 'arrows' | 'motion'>; label: string }[] = [
  { key: 'coordinates', label: 'Coordinates' },
  { key: 'evalBar', label: 'Evaluation bar' },
  { key: 'arrows', label: 'Best-move arrows' },
  { key: 'motion', label: 'Animations' },
];

/** A gear button that opens the settings panel (a native popover, so Esc and outside clicks close it). */
export function SettingsButton() {
  const s = useSettings();
  return (
    <>
      <button type="button" class="icon-button" popovertarget="settings" aria-label="Settings" title="Settings">
        <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">
          <path
            d="M12 15.2a3.2 3.2 0 1 0 0-6.4 3.2 3.2 0 0 0 0 6.4zM19.4 13.5l1.6 1.2-1.8 3.1-1.9-.6a7.6 7.6 0 0 1-2 1.2L15 20.4h-3.6l-.4-2a7.6 7.6 0 0 1-2-1.2l-1.9.6-1.8-3.1 1.6-1.2a7.4 7.4 0 0 1 0-2.4L5.3 9.9l1.8-3.1 1.9.6a7.6 7.6 0 0 1 2-1.2l.4-2h3.6l.4 2a7.6 7.6 0 0 1 2 1.2l1.9-.6 1.8 3.1-1.6 1.2a7.4 7.4 0 0 1 0 2.4z"
            fill="none"
            stroke="currentColor"
            stroke-width="1.7"
            stroke-linejoin="round"
          />
        </svg>
      </button>
      <div id="settings" popover="auto" class="settings" role="dialog" aria-label="Settings">
        <section>
          <h2 class="settings-title">Theme</h2>
          <div class="theme-grid" role="radiogroup" aria-label="Theme">
            {THEMES.map((t) => (
              <button
                key={t.id}
                type="button"
                role="radio"
                aria-checked={s.theme === t.id}
                class="theme-option"
                data-theme={t.id}
                onClick={(e) => {
                  const box = (e.currentTarget as HTMLElement).getBoundingClientRect();
                  applyTheme(t.id, { x: box.left + box.width / 2, y: box.top + box.height / 2 });
                }}
              >
                <span class="theme-preview" aria-hidden="true">
                  <span class="theme-board" />
                  <span class="theme-accent" />
                </span>
                {t.label}
              </button>
            ))}
          </div>
        </section>

        <section>
          <h2 class="settings-title">Pieces</h2>
          <div class="piece-grid" role="radiogroup" aria-label="Pieces">
            {PIECE_SETS.map((p) => (
              <button
                key={p.id}
                type="button"
                role="radio"
                aria-checked={s.pieces === p.id}
                class="piece-option"
                onClick={() => updateSettings({ pieces: p.id })}
              >
                <img src={`/pieces/${p.id}/wN.svg`} alt="" width="36" height="36" loading="lazy" />
                {p.label}
              </button>
            ))}
          </div>
        </section>

        <section>
          <h2 class="settings-title">Board</h2>
          <div class="toggles">
            {TOGGLES.map((t) => (
              <label key={t.key} class="toggle">
                <span>{t.label}</span>
                <input type="checkbox" role="switch" checked={s[t.key]} onChange={(e) => updateSettings({ [t.key]: (e.target as HTMLInputElement).checked })} />
              </label>
            ))}
          </div>
        </section>

        <section>
          <h2 class="settings-title">Engine depth</h2>
          <div class="segmented segmented-wide" role="radiogroup" aria-label="Engine depth">
            {DEPTHS.map((d) => (
              <button key={d.depth} type="button" role="radio" aria-checked={s.depth === d.depth} onClick={() => updateSettings({ depth: d.depth })}>
                {d.label} <span class="muted">{d.depth}</span>
              </button>
            ))}
          </div>
          <p class="settings-note">Deeper is stronger but slower. Each depth's review is saved separately.</p>
        </section>
      </div>
    </>
  );
}
