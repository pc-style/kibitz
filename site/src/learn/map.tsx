import { TopNav } from '../ui/nav';
import { Piece } from '../ui/piece';
import { FINAL } from './bot';
import { COURSE, LESSONS } from './course';
import { useStars } from './progress';
import type { Lesson } from './types';
import { Stars } from './ui';
import './learn.css';

/** The course: every unit and lesson in order, with your stars and the next lesson marked. */
export function CourseMap() {
  const stars = useStars();
  const stops = [...LESSONS.map((l) => l.id), FINAL.id];
  const done = stops.filter((id) => stars[id]).length;
  const earned = stops.reduce((sum, id) => sum + (stars[id] ?? 0), 0);
  const nextId = stops.find((id) => !stars[id]);
  const next = nextId === FINAL.id ? FINAL : LESSONS.find((l) => l.id === nextId);

  return (
    <main class="learn">
      <TopNav current="learn" />
      <header class="learn-head">
        <h1>Learn chess</h1>
        <p class="home-lede">
          Short lessons you play on the board, from how the pieces move to your first checkmate, forks and pins. Start at
          the top, or skip to whatever you don't know yet.
        </p>
        <div class="learn-progress">
          {next ? (
            <a class="button button-primary" href={`#/learn/${next.id}`}>
              {done ? `Continue: ${next.title}` : 'Start the first lesson'}
            </a>
          ) : null}
          <span class="muted">
            {done} of {stops.length} done · {earned} of {stops.length * 3} stars
          </span>
        </div>
      </header>

      {COURSE.filter((u) => u.lessons.length).map((unit, i) => (
        <section key={unit.id} class="unit" aria-labelledby={`unit-${unit.id}`}>
          <h2 id={`unit-${unit.id}`}>
            <span class="unit-n">{i + 1}</span>
            {unit.title}
          </h2>
          <ol class="lesson-grid">
            {unit.lessons.map((l: Lesson) => (
              <LessonCard key={l.id} id={l.id} icon={l.icon} title={l.title} blurb={l.blurb} stars={stars[l.id]} next={l.id === nextId} />
            ))}
          </ol>
        </section>
      ))}

      <section class="unit" aria-labelledby="unit-final">
        <h2 id="unit-final">
          <span class="unit-n">★</span>
          Put it together
        </h2>
        <ol class="lesson-grid">
          <LessonCard id={FINAL.id} icon="king" title={FINAL.title} blurb={FINAL.blurb} stars={stars[FINAL.id]} next={nextId === FINAL.id} />
        </ol>
      </section>
    </main>
  );
}

function LessonCard(props: { id: string; icon: Lesson['icon']; title: string; blurb: string; stars?: number; next: boolean }) {
  return (
    <li>
      <a class={`lesson-card ${props.next ? 'lesson-card-next' : ''}`} href={`#/learn/${props.id}`} aria-current={props.next ? 'step' : undefined}>
        <Piece role={props.icon} color="white" class="lesson-card-icon" />
        <span class="lesson-card-text">
          <strong>{props.title}</strong>
          <span>{props.blurb}</span>
        </span>
        {props.stars ? <Stars count={props.stars} small /> : props.next ? <span class="lesson-card-tag">Next</span> : null}
      </a>
    </li>
  );
}
