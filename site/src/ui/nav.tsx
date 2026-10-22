import { Piece } from './piece';
import { SettingsButton } from './settings';

export type Section = 'learn' | 'analysis' | 'play';

const LINKS: { id: Section; label: string; href: string }[] = [
  { id: 'learn', label: 'Learn', href: '#/learn' },
  { id: 'play', label: 'Play', href: '#/play' },
  { id: 'analysis', label: 'Analysis', href: '#/analysis' },
];

const SOON = ['Puzzles'];

/** The one bar above every page: logo, sections, settings. The app renders it once, so it never moves between pages. */
export function TopNav({ current }: { current?: Section }) {
  return (
    <header class="topbar">
      <div class="topbar-inner">
        <a class="logo" href="#/" aria-label="Kibitz home">
          <Piece role="knight" color="white" class="logo-mark" />
          <span class="wordmark">kibitz</span>
        </a>
        <nav class="topnav" aria-label="Sections">
          {LINKS.map((l) => (
            <a key={l.id} href={l.href} aria-current={current === l.id ? 'page' : undefined}>
              {l.label}
            </a>
          ))}
          {SOON.map((label) => (
            <span key={label} class="topnav-soon" title={`${label} is coming soon`}>
              {label} <small>Soon</small>
            </span>
          ))}
        </nav>
        <SettingsButton />
      </div>
    </header>
  );
}
