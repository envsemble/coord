// What a project shows at a glance, in the hub's project menu: its avatar (the initials of its name on
// a square in its own colour) and its facts from the listing (its open plans, how many agents work on
// them or wait for the person, when it last changed). Pure, so it is unit-tested.
import type { Project } from '../types';

/** Up to two initials: of its first two words, else of its one word. */
export function initials(name: string): string {
  const words = name.trim().split(/[\s_-]+/).filter(Boolean);
  const letters = words.length > 1 ? [words[0], words[1]].map(word => [...word][0]) : [...(words[0] ?? '?')].slice(0, 1);
  return letters.join('').toUpperCase();
}

/** Hues far enough apart to tell projects apart. */
const hues = [8, 32, 50, 95, 150, 180, 205, 230, 262, 290, 320, 345];
/** The hue of a project's avatar, from its ID: the same project keeps its colour, whatever it is named. */
export function projectHue(projectId: string): number {
  let hash = 0;
  for (const character of projectId) hash = (hash * 31 + character.charCodeAt(0)) >>> 0;
  return hues[hash % hues.length];
}

/**
 * What the listing says of a project: its open plans, those its agents work on and those that are the
 * person's turn, as the plans declare, and when it changed. Its plans are those in it: what it keeps
 * that lists no other projects, and what any active project of the listing (`projects`) keeps that
 * lists it.
 */
export function projectFacts(project: Pick<Project, 'summary'> & Partial<Pick<Project, 'id'>>, projects: readonly (Pick<Project, 'summary'> & Partial<Pick<Project, 'id' | 'state'>>)[] = [project]): { open: number; working: number; waiting: number; updated: string | null } | null {
  const summary = project.summary;
  if (!summary) return null;
  const active = projects.filter(each => each === project || each.id === project.id || each.state === 'active').flatMap(each => (each.summary?.active ?? []).filter(work => {
    const listed = (work.projects ?? []).flatMap(link => link.projectId ? [link.projectId] : []);
    return listed.length ? project.id !== undefined && listed.includes(project.id) : each === project || each.id === project.id;
  }));
  return {
    open: active.filter(work => work.state !== 'closed').length,
    working: active.filter(work => work.turn?.kind === 'working' || work.turn?.kind === 'planning').length,
    waiting: active.filter(work => work.turn?.kind === 'your_turn').length,
    updated: summary.updated,
  };
}
