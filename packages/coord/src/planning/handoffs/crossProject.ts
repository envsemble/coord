// The handoffs between the home's projects' work, as the project list has them: each work item's
// `continues`, found in its project or another by the project's planning folder's name, and in the
// other direction the work that continues it ("continued in"). Computed from the listing alone.
import path from 'node:path';
import type { HandoffLink } from '../types.ts';
import type { ProjectWork } from '../projects/projectSummary.ts';

/** A listed project: its ID, its planning folder, its name, and its summary (null when it could not be read). */
export interface ListedProject { projectId: string; folder: string; name: string; summary: { active: ProjectWork[]; closed: ProjectWork[]; former?: Record<string, string> } | null }

const caseless = process.platform === 'win32' || process.platform === 'darwin';
const keyOf = (value: string) => caseless ? value.toLowerCase() : value;

/**
 * Fill in each work item's `continues` (from the names its plan gives) and `continuedIn`, in place.
 * Another project is found as the plan's own folder finds it (handoffFolder): by its planning
 * folder's name among the folders beside it in the home, and each work item is linked once.
 * Every link carries its project's ID, the same project's included. A reference that names no
 * work item stays, without title or state, and without a project ID when it names no project.
 */
export function linkHandoffs(projects: ListedProject[]) {
  const byFolder = new Map(projects.map(project => [keyOf(path.resolve(project.folder)), project]));
  const work = (project: ListedProject) => [...project.summary?.active ?? [], ...project.summary?.closed ?? []];
  const link = (to: ListedProject, item: ProjectWork | undefined, workId: string): HandoffLink => ({
    projectId: to.projectId, project: path.basename(to.folder), projectName: to.name, workId,
    title: item?.title ?? null, state: item?.state ?? null, outcome: item?.outcome ?? null,
  });
  for (const project of projects) for (const item of work(project)) item.continuedIn = [];
  for (const project of projects) {
    for (const item of work(project)) {
      const seen = new Set<string>();
      item.continues = (item.continues ?? []).flatMap(named => {
        const target = named.project && keyOf(named.project) !== keyOf(path.basename(project.folder)) ? byFolder.get(keyOf(path.join(path.dirname(path.resolve(project.folder)), named.project))) : project;
        const key = (target ? target.projectId : '?' + keyOf(named.project)) + '\0' + named.workId;
        if (seen.has(key)) return [];
        seen.add(key);
        if (!target) return [{ ...named, projectId: null, projectName: named.project, title: null, state: null, outcome: null }];
        // A former ID leads to the part it now names.
        const id = target.summary?.former?.[named.workId] ?? named.workId;
        const found = work(target).find(other => other.id === id);
        if (found) found.continuedIn!.push(link(project, item, item.id));
        return [link(target, found, found ? id : named.workId)];
      });
    }
  }
}

/**
 * Fill in the projects each work item is in (its plan's `projects`), in place: each named project
 * found among the listed ones by its planning folder's name, as a handoff finds a project, with its
 * ID and its name. A name no listed project has stays, without an ID.
 */
export function linkProjects(projects: ListedProject[]) {
  const byName = new Map(projects.map(project => [keyOf(path.basename(path.resolve(project.folder))), project]));
  for (const project of projects) {
    for (const item of [...project.summary?.active ?? [], ...project.summary?.closed ?? []]) {
      if (!item.projects) continue;
      item.projects = item.projects.map(named => {
        const found = byName.get(keyOf(named.project));
        return found ? { projectId: found.projectId, project: path.basename(found.folder), projectName: found.name } : { projectId: null, project: named.project, projectName: named.project };
      });
    }
  }
}

/** Each listed project's handoffs by work item, for the plans its folder's snapshot shows. */
export function handoffsByWork(project: ListedProject) {
  const found = new Map<string, { continues: HandoffLink[]; continuedIn: HandoffLink[] }>();
  for (const item of [...project.summary?.active ?? [], ...project.summary?.closed ?? []]) found.set(item.id, { continues: item.continues ?? [], continuedIn: item.continuedIn ?? [] });
  return found;
}
