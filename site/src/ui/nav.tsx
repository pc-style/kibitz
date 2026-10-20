import type { ComponentChildren } from 'preact';
import { Piece } from './piece';
import { SettingsButton } from './settings';

export type Section = 'learn' | 'analysis';

const LINKS: { id: Section; label: string; href: string }[] = [
  { id: 'learn', label: 'Learn', href: '#/learn' },
  { id: 'analysis', label: 'Analysis', href: '#/analysis' },
];

const SOON = ['Play', 'Puzzles'];

/** The bar on every page: logo, sections, anything page-specific (a game's title), settings. */
export function TopNav({ current, children }: { current?: Section; children?: ComponentChildren }) {
  return (
    <header class="topbar">
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
      {children ?? <span class="topbar-gap" />}
      <SettingsButton />
    </header>
  );
}
