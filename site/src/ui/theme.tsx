import { reducedMotion, updateSettings, type Theme } from '../settings';

export { reducedMotion };

let running: ViewTransition | null = null;

/** Switches theme; the new theme spreads out from the swatch that was pressed. */
export function applyTheme(theme: Theme, from: { x: number; y: number }) {
  const root = document.documentElement;
  const apply = () => updateSettings({ theme });
  if (!document.startViewTransition || reducedMotion()) return apply();

  // A second click mid-reveal finishes the first one instantly instead of overlapping it.
  running?.skipTransition();
  root.classList.add('theme-reveal');
  const transition = document.startViewTransition(apply);
  running = transition;
  transition.ready
    .then(() => {
      const radius = Math.hypot(Math.max(from.x, innerWidth - from.x), Math.max(from.y, innerHeight - from.y));
      root.animate(
        { clipPath: [`circle(0px at ${from.x}px ${from.y}px)`, `circle(${radius}px at ${from.x}px ${from.y}px)`] },
        { duration: 420, easing: 'cubic-bezier(0.2, 0.7, 0.2, 1)', pseudoElement: '::view-transition-new(root)' },
      );
    })
    .catch(() => {
      // Skipped: the theme already applied without the reveal.
    });
  transition.finished.finally(() => {
    if (running !== transition) return;
    running = null;
    root.classList.remove('theme-reveal');
  });
}
