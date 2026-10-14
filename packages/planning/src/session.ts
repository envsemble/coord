import path from 'node:path';
import { stat } from 'node:fs/promises';
import { loadPlanning } from './planning.ts';
import { Telemetry } from './telemetry.ts';
import { cacheOutsidePlanning, statisticsDirectory } from './storage.ts';
import { DiagramCatalog } from './diagrams.ts';
import { createScopeCache } from './atlasScope.ts';

/** Everything that depends on the open planning folder; replaced as a whole when the folder switches. */
export class PlanningSession {
  readonly root: string;
  readonly diagrams: DiagramCatalog;
  readonly index: (force?: boolean) => ReturnType<typeof loadPlanning>;
  readonly dataRoot: string;
  readonly telemetry: Telemetry | null;
  readonly usageDirectory: string | null;
  readonly collectionError: string | null;
  private constructor(values: Pick<PlanningSession, 'root' | 'diagrams' | 'index' | 'dataRoot' | 'telemetry' | 'usageDirectory' | 'collectionError'>) {
    this.root = values.root; this.diagrams = values.diagrams; this.index = values.index; this.dataRoot = values.dataRoot;
    this.telemetry = values.telemetry; this.usageDirectory = values.usageDirectory; this.collectionError = values.collectionError;
  }

  static async open(root: string, options: { dataBase?: string } = {}) {
    const diagrams = new DiagramCatalog(root);
    const index = createScopeCache(() => loadPlanning(root), async () => {
      const file = await stat(path.join(root, 'planning.json'));
      return file.mtimeMs + ':' + file.size;
    });
    const dataRoot = await statisticsDirectory(root, options.dataBase);
    let telemetry: Telemetry | null = null, usageDirectory: string | null = null, collectionError: string | null = null;
    try {
      usageDirectory = await cacheOutsidePlanning(root, dataRoot);
      telemetry = new Telemetry(path.join(usageDirectory, 'usage.sqlite'));
    } catch { collectionError = 'Local usage collection is unavailable. Document viewing still works; statistics are unknown.'; }
    return new PlanningSession({ root, diagrams, index, dataRoot, telemetry, usageDirectory, collectionError });
  }

  close() {
    try { this.telemetry?.close(); } catch { /* Already closed. */ }
  }
}
