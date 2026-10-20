import { useState } from 'preact/hooks';

export const THEMES = [
  { id: 'felt', label: 'Felt' },
  { id: 'walnut', label: 'Walnut' },
  { id: 'midnight', label: 'Midnight' },
  { id: 'paper', label: 'Paper' },
] as const;

export type Theme = (typeof THEMES)[number]['id'];

export const reducedMotion = () => matchMedia('(prefers-reduced-motion: reduce)').matches;

const currentTheme = () => (document.documentElement.dataset.theme as Theme | undefined) ?? 'felt';

/** Switches theme; with a click origin, the new theme spreads out from the swatch that was pressed. */
function applyTheme(theme: Theme, from: { x: number; y: number }) {
  const root = document.documentElement;
  const apply = () => {
    root.dataset.theme = theme;
    try {
      localStorage.setItem('kibitz:theme', theme);
    } catch {
      // Private mode: the theme still applies for this visit.
    }
  };
  if (!document.startViewTransition || reducedMotion()) return apply();

  root.classList.add('theme-reveal');
  const transition = document.startViewTransition(apply);
  transition.ready.then(() => {
    const radius = Math.hypot(Math.max(from.x, innerWidth - from.x), Math.max(from.y, innerHeight - from.y));
    root.animate(
      { clipPath: [`circle(0px at ${from.x}px ${from.y}px)`, `circle(${radius}px at ${from.x}px ${from.y}px)`] },
      { duration: 480, easing: 'cubic-bezier(0.2, 0.7, 0.2, 1)', pseudoElement: '::view-transition-new(root)' },
    );
  });
  transition.finished.finally(() => root.classList.remove('theme-reveal'));
}

export function ThemePicker() {
  const [theme, setTheme] = useState(currentTheme);
  return (
    <div class="themes" role="radiogroup" aria-label="Theme">
      {THEMES.map((t) => (
        <button
          key={t.id}
          type="button"
          role="radio"
          class="theme-swatch"
          data-theme={t.id}
          aria-checked={theme === t.id}
          aria-label={`${t.label} theme`}
          title={t.label}
          onClick={(e) => {
            const box = (e.currentTarget as HTMLElement).getBoundingClientRect();
            applyTheme(t.id, { x: box.left + box.width / 2, y: box.top + box.height / 2 });
            setTheme(t.id);
          }}
        />
      ))}
    </div>
  );
}
