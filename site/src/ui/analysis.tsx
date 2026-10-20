import { TopNav } from './nav';

/** Free analysis board (being built). */
export function AnalysisBoard({ fen }: { fen?: string }) {
  return (
    <main class="home">
      <TopNav current="analysis" />
      <p class="muted">Analysis board coming. Start position: {fen ?? 'standard'}</p>
    </main>
  );
}
