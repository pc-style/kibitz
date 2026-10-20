import type { Lesson, Unit } from './types';
import { capturing } from './units/capturing';
import { checkUnit } from './units/check';
import { game } from './units/game';
import { pieces } from './units/pieces';
import { skills } from './units/skills';
import { special } from './units/special';

/** The whole course in order. The last stop, a game against the practice bot, lives outside this list. */
export const COURSE: Unit[] = [
  { id: 'pieces', title: 'How the pieces move', lessons: pieces },
  { id: 'capturing', title: 'Capturing', lessons: capturing },
  { id: 'check', title: 'Check and checkmate', lessons: checkUnit },
  { id: 'special', title: 'Special moves', lessons: special },
  { id: 'game', title: 'Playing a game', lessons: game },
  { id: 'skills', title: 'First skills', lessons: skills },
];

export const LESSONS: Lesson[] = COURSE.flatMap((u) => u.lessons);
