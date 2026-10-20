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
        {/* Eight teeth and the hole, all centred on 12,12 so the gear sits dead centre in the button. */}
        <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">
          <path
            d="M10.32 5.72L10.62 3.31L13.38 3.31L13.68 5.72L15.25 6.37L17.17 4.88L19.12 6.83L17.63 8.75L18.28 10.32L20.69 10.62L20.69 13.38L18.28 13.68L17.63 15.25L19.12 17.17L17.17 19.12L15.25 17.63L13.68 18.28L13.38 20.69L10.62 20.69L10.32 18.28L8.75 17.63L6.83 19.12L4.88 17.17L6.37 15.25L5.72 13.68L3.31 13.38L3.31 10.62L5.72 10.32L6.37 8.75L4.88 6.83L6.83 4.88L8.75 6.37ZM15 12a3 3 0 1 1-6 0 3 3 0 0 1 6 0Z"
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
