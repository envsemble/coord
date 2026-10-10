import { DatabaseSync } from 'node:sqlite';
import { appendFileSync, mkdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import type { DocumentUsage, Usage } from './types.ts';
import { PlanningError } from './planning.ts';

export const schema = 'CREATE TABLE IF NOT EXISTS metadata (key TEXT PRIMARY KEY, value TEXT NOT NULL); CREATE TABLE IF NOT EXISTS events (sequence INTEGER PRIMARY KEY, id TEXT NOT NULL UNIQUE, source TEXT NOT NULL, document_key TEXT NOT NULL, path TEXT NOT NULL, task_id TEXT, session_id TEXT, timestamp TEXT NOT NULL, revision TEXT, content_hash TEXT); CREATE INDEX IF NOT EXISTS event_document ON events(document_key); CREATE TABLE IF NOT EXISTS failures (timestamp TEXT NOT NULL, detail TEXT NOT NULL);';
export interface ViewEvent { id: string; path: string; session: string; key: string; revision: string | null; contentHash: string | null }
export function recordCollectionGap(directory: string, source: 'dashboard_view' | 'agent_report') {
  try {
    mkdirSync(directory, { recursive: true });
    appendFileSync(path.join(directory, 'collection-gaps.jsonl'), JSON.stringify({ source, timestamp: new Date().toISOString() }) + '\n');
  } catch { /* A wholly unavailable cache cannot retain its own failure; the caller must disclose it. */ }
}
export class Telemetry {
  private db: DatabaseSync;
  private filename: string;
  constructor(filename: string) {
    this.filename = filename;
    if (filename !== ':memory:') mkdirSync(path.dirname(filename), { recursive: true });
    this.db = new DatabaseSync(filename);
    this.db.exec('PRAGMA journal_mode = WAL; PRAGMA busy_timeout = 2000;' + schema);
    this.db.prepare('INSERT OR IGNORE INTO metadata (key, value) VALUES (?, ?)').run('dashboard_since', new Date().toISOString());
  }
  recordView(event: ViewEvent) {
    if (!event || !/^[a-zA-Z0-9-]{8,80}$/.test(event.id) || !/^[a-zA-Z0-9-]{8,80}$/.test(event.session) || typeof event.path !== 'string' || event.path.length > 2048) throw new PlanningError('This view event is invalid.');
    const now = new Date().toISOString();
    try {
      if (this.db.prepare('SELECT 1 FROM events WHERE source = ? AND document_key = ? AND session_id = ? AND timestamp > ? LIMIT 1').get('dashboard_view', event.key, event.session, new Date(Date.now() - 30000).toISOString())) return;
      this.db.prepare('INSERT OR IGNORE INTO events (id, source, document_key, path, session_id, timestamp, revision, content_hash) VALUES (?, ?, ?, ?, ?, ?, ?, ?)').run(event.id, 'dashboard_view', event.key, event.path, event.session, now, event.revision, event.contentHash);
    } catch (error) {
      if (this.filename !== ':memory:') recordCollectionGap(path.dirname(this.filename), 'dashboard_view');
      throw error;
    }
  }
  summary(keys?: string[]): Usage {
    const scope = keys === undefined ? '' : keys.length ? ' AND document_key IN (' + keys.map(() => '?').join(',') + ')' : ' AND 0';
    const parameters = keys ?? [];
    const totals = this.db.prepare("SELECT count(*) AS views, count(DISTINCT document_key) AS documentsViewed, count(DISTINCT session_id) AS sessions FROM events WHERE source = 'dashboard_view'" + scope).get(...parameters) as unknown as Pick<Usage, 'views' | 'documentsViewed' | 'sessions'>;
    const agent = this.db.prepare("SELECT count(*) AS reports, count(DISTINCT document_key) AS documentsConsulted, count(DISTINCT task_id) AS tasks, sum(task_id IS NULL) AS unassigned FROM events WHERE source = 'agent_report'" + scope).get(...parameters) as unknown as Pick<Usage, 'reports' | 'documentsConsulted' | 'tasks' | 'unassigned'>;
    const rows = this.db.prepare("SELECT document_key AS key, path, sum(source = 'dashboard_view') AS views, count(DISTINCT CASE WHEN source = 'dashboard_view' THEN session_id END) AS sessions, max(CASE WHEN source = 'dashboard_view' THEN timestamp END) AS lastViewed, sum(source = 'agent_report') AS reports, count(DISTINCT CASE WHEN source = 'agent_report' THEN task_id END) AS tasks, sum(source = 'agent_report' AND task_id IS NULL) AS unassigned, max(CASE WHEN source = 'agent_report' THEN timestamp END) AS lastConsulted FROM events WHERE 1" + scope + " GROUP BY document_key ORDER BY tasks DESC, reports DESC").all(...parameters) as unknown as DocumentUsage[];
    const dashboard = this.db.prepare('SELECT value FROM metadata WHERE key = ?').get('dashboard_since') as { value: string };
    const agentStart = this.db.prepare('SELECT value FROM metadata WHERE key = ?').get('agent_since') as { value: string } | undefined;
    const failures = this.db.prepare('SELECT count(*) AS total FROM failures').get() as { total: number };
    let gaps = 0;
    if (this.filename !== ':memory:') {
      try { gaps = readFileSync(path.join(path.dirname(this.filename), 'collection-gaps.jsonl'), 'utf8').split(/\r?\n/).filter(line => line.trim()).length; }
      catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
    }
    return { dashboardSince: dashboard.value, agentSince: agentStart?.value ?? null, ...totals, ...agent, unassigned: agent.unassigned ?? 0, failures: failures.total + gaps, documents: rows };
  }
  close() { this.db.close(); }
}
