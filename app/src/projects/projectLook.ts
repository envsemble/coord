// What a project's row on the Projects page shows at a glance: its avatar (the initials of its name on
// a quiet square) and its facts from the listing (its open plans, how many agents work on them or wait
// for the person, when it last changed). Pure, so it is unit-tested.
import type { Project } from '../types';

/** Up to two initials: of its first two words, else of its one word. */
export function initials(name: string): string {
  const words = name.trim().split(/[\s_-]+/).filter(Boolean);
  const letters = words.length > 1 ? [words[0], words[1]].map(word => [...word][0]) : [...(words[0] ?? '?')].slice(0, 1);
  return letters.join('').toUpperCase();
}

/** What the listing says of a project: its open plans, those agents work on and those waiting for the person, and when it changed. */
export function projectFacts(project: Pick<Project, 'summary'>): { open: number; working: number; waiting: number; updated: string | null } | null {
  const summary = project.summary;
  if (!summary) return null;
  return {
    open: summary.active.filter(work => work.state !== 'closed').length,
    working: summary.activity.filter(item => item.state === 'working').length,
    waiting: summary.activity.filter(item => item.state === 'waiting').length,
    updated: summary.updated,
  };
}
