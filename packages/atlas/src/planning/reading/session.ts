import path from 'node:path';
import { stat } from 'node:fs/promises';
import { loadPlanning } from './planning.ts';
import { DiagramCatalog } from './diagrams.ts';
import { createScopeCache } from './atlasScope.ts';
import { projectOf, type HomeDatabase } from '../home/database.ts';

/**
 * Everything that depends on an open planning folder: its index, its diagrams, and its project in
 * the home database, where its document use is recorded. The database is the caller's (the host
 * keeps one open); without it, document use is unknown.
 */
export class PlanningSession {
  readonly root: string;
  readonly diagrams: DiagramCatalog;
  readonly index: (force?: boolean) => ReturnType<typeof loadPlanning>;
  readonly database: HomeDatabase | null;
  readonly projectId: number | null;
  readonly collectionError: string | null;
  private constructor(values: Pick<PlanningSession, 'root' | 'diagrams' | 'index' | 'database' | 'projectId' | 'collectionError'>) {
    this.root = values.root; this.diagrams = values.diagrams; this.index = values.index;
    this.database = values.database; this.projectId = values.projectId; this.collectionError = values.collectionError;
  }

  static async open(root: string, options: { database?: HomeDatabase | null } = {}) {
    const diagrams = new DiagramCatalog(root);
    const database = options.database ?? null;
    const index = createScopeCache(() => loadPlanning(root, { database }), async () => {
      const file = await stat(path.join(root, 'planning.json'));
      return file.mtimeMs + ':' + file.size;
    });
    let projectId: number | null = null, collectionError: string | null = null;
    try { if (database) projectId = (await projectOf(database, root)).id; }
    catch { /* Reported below. */ }
    if (projectId === null) collectionError = 'Local usage collection is unavailable. Document viewing still works; statistics are unknown.';
    return new PlanningSession({ root, diagrams, index, database: projectId === null ? null : database, projectId, collectionError });
  }
}
