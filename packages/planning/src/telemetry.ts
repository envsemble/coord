// Document use: the planning documents people view in the app (dashboard_view) and agents report
// consulting (agent_report), kept per project in the home database, and the gaps in that collection
// (a document that could not be recorded, a write that failed).
import type { DocumentUsage, Usage } from './types.ts';
import { PlanningError } from './planning.ts';
import type { HomeDatabase } from './database.ts';

export interface ViewEvent { id: string; path: string; session: string; key: string; revision: string | null; contentHash: string | null }
export type CollectionSource = 'dashboard_view' | 'agent_report';

/** Note that some document use of a project could not be recorded. Never throws: a database that refuses this too cannot keep it. */
export function recordCollectionGap(database: HomeDatabase, projectId: number, reason: CollectionSource) {
  try { database.db.prepare('INSERT INTO collection_gap (project_id, at, reason) VALUES (?, ?, ?)').run(projectId, new Date().toISOString(), reason); }
  catch { /* The caller discloses it. */ }
}

/** Record that a document was viewed in the app; the same document viewed again in the same session within 30 seconds counts once. */
export function recordView(database: HomeDatabase, projectId: number, event: ViewEvent) {
  if (!event || !/^[a-zA-Z0-9-]{8,80}$/.test(event.id) || !/^[a-zA-Z0-9-]{8,80}$/.test(event.session) || typeof event.path !== 'string' || event.path.length > 2048) throw new PlanningError('This view event is invalid.');
  const now = new Date().toISOString();
  try {
    if (database.db.prepare("SELECT 1 FROM document_use WHERE project_id = ? AND source = 'dashboard_view' AND document_key = ? AND session = ? AND at > ? LIMIT 1").get(projectId, event.key, event.session, new Date(Date.now() - 30000).toISOString())) return;
    database.db.prepare("INSERT OR IGNORE INTO document_use (id, project_id, source, path, document_key, session, at, revision, content_hash) VALUES (?, ?, 'dashboard_view', ?, ?, ?, ?, ?, ?)")
      .run(event.id, projectId, event.path, event.key, event.session, now, event.revision, event.contentHash);
  } catch (error) {
    recordCollectionGap(database, projectId, 'dashboard_view');
    throw error;
  }
}

/**
 * A project's document use: views and agent reports, overall and per document (or for the documents
 * given). Views count since the project was added; agent reports since the first one.
 */
export function usageSummary(database: HomeDatabase, projectId: number, keys?: string[]): Usage {
  const scope = keys === undefined ? '' : keys.length ? ' AND document_key IN (' + keys.map(() => '?').join(',') + ')' : ' AND 0';
  const parameters = [projectId, ...(keys ?? [])];
  const one = (query: string) => database.db.prepare(query).get(...parameters) as Record<string, number | string | null>;
  const totals = one("SELECT count(*) AS views, count(DISTINCT document_key) AS documentsViewed, count(DISTINCT session) AS sessions FROM document_use WHERE project_id = ? AND source = 'dashboard_view'" + scope);
  const agent = one("SELECT count(*) AS reports, count(DISTINCT document_key) AS documentsConsulted, count(DISTINCT work_id) AS tasks, ifnull(sum(work_id IS NULL), 0) AS unassigned FROM document_use WHERE project_id = ? AND source = 'agent_report'" + scope);
  const documents = database.db.prepare("SELECT document_key AS key, path, sum(source = 'dashboard_view') AS views, count(DISTINCT CASE WHEN source = 'dashboard_view' THEN session END) AS sessions, max(CASE WHEN source = 'dashboard_view' THEN at END) AS lastViewed, sum(source = 'agent_report') AS reports, count(DISTINCT CASE WHEN source = 'agent_report' THEN work_id END) AS tasks, sum(source = 'agent_report' AND work_id IS NULL) AS unassigned, max(CASE WHEN source = 'agent_report' THEN at END) AS lastConsulted FROM document_use WHERE project_id = ?" + scope + ' GROUP BY document_key ORDER BY tasks DESC, reports DESC')
    .all(...parameters).map(row => ({ ...row })) as unknown as DocumentUsage[];
  const since = database.db.prepare("SELECT (SELECT created_at FROM project WHERE id = ?) AS dashboard, (SELECT min(at) FROM document_use WHERE project_id = ? AND source = 'agent_report') AS agent").get(projectId, projectId) as { dashboard: string | null; agent: string | null };
  const gaps = database.db.prepare('SELECT count(*) AS total FROM collection_gap WHERE project_id = ?').get(projectId) as { total: number };
  return {
    dashboardSince: since.dashboard, agentSince: since.agent,
    views: Number(totals.views), documentsViewed: Number(totals.documentsViewed), sessions: Number(totals.sessions),
    reports: Number(agent.reports), documentsConsulted: Number(agent.documentsConsulted), tasks: Number(agent.tasks), unassigned: Number(agent.unassigned),
    failures: Number(gaps.total), documents,
  };
}
