import { TopNav } from '../ui/nav';

export function LessonPage({ id }: { id: string }) {
  return (
    <main class="home">
      <TopNav current="learn" />
      <p>{id}</p>
    </main>
  );
}
