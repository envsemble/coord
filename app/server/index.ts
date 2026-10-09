import express from 'express';
import { createServer } from 'node:http';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { existsSync } from 'node:fs';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import path from 'node:path';
import { PlanningError, readDocument, recentRootsFile, recordCollectionGap, resolveDocument, discoverPlanningRoots, inspectPlanningRoot, RecentPlanningRoots, samePlatformPath, type PlanningRootInfo } from '@atlas/planning';
import { PlanningSession } from '@atlas/planning/session';
import type { Usage } from '../src/types.ts';
import { localOrigin } from './origin.ts';

const { values } = parseArgs({ options: {
  dev: { type: 'boolean', default: false }, 'planning-dir': { type: 'string' }, port: { type: 'string', default: '4317' }, 'data-dir': { type: 'string' },
} });
const appRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const initialRoot = path.resolve(values['planning-dir'] ?? path.join(appRoot, '../../planning'));
// --data-dir overrides the Atlas data folder (ATLAS_DATA_DIR, else the per-user default).
const dataBase = values['data-dir'];
const port = Number(values.port);
if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('Choose a valid --port.');
const recents = new RecentPlanningRoots(recentRootsFile(dataBase));
let session = await PlanningSession.open(initialRoot, { dataBase });
await inspectPlanningRoot(initialRoot).then(info => recents.remember(info.path)).catch(() => undefined);
let discovery: { root: string; expires: number; roots: Promise<PlanningRootInfo[]> } | null = null;
let switching: Promise<unknown> = Promise.resolve();

const app = express();
const http = createServer(app);
app.disable('x-powered-by');
app.use((request, response, next) => {
  const hostname = request.hostname.toLowerCase();
  if (!['127.0.0.1', 'localhost', '[::1]'].includes(hostname)) { response.status(403).json({ error: 'Use the local dashboard address.' }); return; }
  const origin = request.get('origin');
  if (origin && !localOrigin(origin, port)) {
    response.status(403).json({ error: 'Open this request from the local dashboard.' }); return;
  }
  next();
});
app.use('/api', express.json({ limit: '12kb' }));
// Record requests name the folder their caller loaded. After a switch (perhaps from another tab),
// reject them rather than answer with a different folder's records under the same work IDs.
const folderNeutral = new Set(['/snapshot', '/planning-roots', '/planning-root']);
app.use('/api', (request, response, next) => {
  if (folderNeutral.has(request.path)) { next(); return; }
  const header = request.get('x-planning-root');
  let claimed: string | undefined = typeof request.query.root === 'string' ? request.query.root : undefined;
  if (header) { try { claimed = decodeURIComponent(header); } catch { claimed = header; } }
  if (claimed !== undefined && !samePlatformPath(claimed, session.root)) {
    response.status(409).json({ error: 'The planning folder changed. Reloading its records.', code: 'planning-root-changed' }); return;
  }
  next();
});
app.get('/api/snapshot', async (_request, response) => {
  response.setHeader('Cache-Control', 'no-store');
  const current = session;
  const unavailable = { dashboardSince: null, agentSince: null, views: 0, documentsViewed: 0, sessions: 0, reports: 0, documentsConsulted: 0, tasks: 0, unassigned: 0, failures: 0, documents: [] };
  const snapshot = await current.index(true);
  let usage: Usage = unavailable;
  const usageByRepository: Record<string, Usage> = Object.create(null);
  let collectionError = current.collectionError;
  try {
    if (current.telemetry) {
      usage = current.telemetry.summary();
      for (const repository of snapshot.repositories) usageByRepository[repository.id] = current.telemetry.summary(snapshot.documents.filter(document => document.repositories.includes(repository.id)).map(document => document.key));
    }
  } catch { collectionError = 'Local usage statistics could not be read. Document viewing still works; collection is incomplete.'; }
  let diagrams: Record<string, number> = {};
  try { diagrams = current.atlas.counts(snapshot); } catch { /* Counts are an indicator only. */ }
  const work = snapshot.work.map(item => ({ ...item, diagrams: diagrams[item.id] ?? 0 }));
  response.json({ ...snapshot, work, usage, usageByRepository, collectionError });
});
app.get('/api/planning-roots', async (_request, response) => {
  response.setHeader('Cache-Control', 'no-store');
  const root = session.root;
  const current = await inspectPlanningRoot(root).catch((error: Error) => ({ path: root, name: path.basename(root), parent: path.dirname(root), workItems: null, error: error.message }));
  if (!discovery || discovery.root !== root || Date.now() > discovery.expires) discovery = { root, expires: Date.now() + 30000, roots: discoverPlanningRoots(root).catch(() => []) };
  const others = (item: { path: string }) => !samePlatformPath(item.path, current.path);
  const recent = (await Promise.all((await recents.list()).filter(item => others({ path: item })).map(item => inspectPlanningRoot(item).catch(() => null)))).filter((item): item is PlanningRootInfo => item !== null);
  const discovered = (await discovery.roots).filter(others).filter(item => !recent.some(entry => samePlatformPath(entry.path, item.path)));
  response.json({ current, recent, discovered });
});
app.post('/api/planning-root', async (request, response) => {
  // Same posture as /api/events: local host and origin (above), JSON only, and never a cross-site fetch.
  if (!request.is('application/json')) throw new PlanningError('Send the folder as JSON.', 415);
  const site = request.get('sec-fetch-site');
  if (site && !['same-origin', 'none'].includes(site)) throw new PlanningError('Open this request from the local dashboard.', 403);
  const requested = (request.body as { path?: unknown } | undefined)?.path;
  const next = switching.then(async () => {
    const info = await inspectPlanningRoot(requested);
    if (!samePlatformPath(info.path, session.root)) {
      const previous = session;
      session = await PlanningSession.open(info.path, { dataBase });
      discovery = null;
      // Let in-flight requests on the previous folder finish before closing its usage store.
      setTimeout(() => previous.close(), 5000).unref();
    }
    await recents.remember(info.path);
    return info;
  });
  switching = next.catch(() => undefined);
  response.setHeader('Cache-Control', 'no-store');
  response.json(await next);
});
app.get('/api/document', async (request, response) => {
  if (typeof request.query.path !== 'string') throw new PlanningError('Choose a document.');
  response.setHeader('Cache-Control', 'no-store');
  response.json(await readDocument(session.root, request.query.path));
});
for (const endpoint of ['models', 'model', 'references']) app.get('/api/atlas/' + endpoint, async (request, response) => {
  const current = session;
  const work = typeof request.query.work === 'string' ? request.query.work : undefined;
  if (!work && endpoint !== 'references') throw new PlanningError('Choose a work item.');
  const snapshot = await current.index();
  response.setHeader('Cache-Control', 'no-store');
  if (endpoint === 'models') response.json(current.atlas.list(snapshot, work!));
  else if (endpoint === 'model') {
    if (typeof request.query.handle !== 'string') throw new PlanningError('Choose an Atlas model.');
    response.json(await current.atlas.prepared(snapshot, work!, request.query.handle));
  } else {
    if (typeof request.query.path !== 'string') throw new PlanningError('Choose an indexed document.');
    response.json(current.atlas.references(snapshot, work, request.query.path));
  }
});
app.get('/api/file', async (request, response) => {
  if (typeof request.query.path !== 'string') throw new PlanningError('Choose an attachment.');
  const filename = await resolveDocument(session.root, request.query.path);
  response.setHeader('Content-Security-Policy', "sandbox; default-src 'none'");
  response.setHeader('X-Content-Type-Options', 'nosniff');
  if (request.query.download === '1') response.download(filename);
  else response.sendFile(filename);
});
app.post('/api/events', async (request, response) => {
  const current = session;
  const event = request.body as { id: string; path: string; session: string; contentHash?: string };
  if (typeof event?.path !== 'string') throw new PlanningError('Choose a document for this event.');
  const snapshot = await current.index();
  const document = snapshot.documents.find(file => file.path === event.path);
  if (!document) throw new PlanningError('This document is not in the connected planning folder.', 403);
  let revision: string | null = null;
  try { if (snapshot.gitAvailable) revision = (await promisify(execFile)('git', ['-C', current.root, 'rev-parse', 'HEAD'])).stdout.trim(); } catch { /* Unknown revision remains null. */ }
  const content = await readDocument(current.root, event.path);
  if (event.contentHash && content.contentHash !== event.contentHash) { response.status(409).json({ error: 'The document changed; refresh to record the current view.' }); return; }
  if (!current.telemetry) {
    if (current.usageDirectory) recordCollectionGap(current.usageDirectory, 'dashboard_view');
    throw new PlanningError('Local view collection is unavailable; document reading remains available.', 503);
  }
  current.telemetry.recordView({ ...event, key: document.key, revision, contentHash: content.contentHash || null });
  response.status(204).end();
});
app.use('/api', (_request, response) => { response.status(404).json({ error: 'This dashboard endpoint does not exist.' }); });
if (values.dev) {
  const { createServer: createViteServer } = await import('vite');
  const vite = await createViteServer({ root: appRoot, server: { middlewareMode: true, hmr: { server: http } } });
  app.use(vite.middlewares);
} else {
  const distribution = path.join(appRoot, 'dist');
  if (!existsSync(path.join(distribution, 'index.html'))) throw new Error('Build the dashboard first with npm run build, or use npm run dev.');
  app.use(express.static(distribution));
  app.get(/.*/, (_request, response) => { response.sendFile(path.join(distribution, 'index.html')); });
}
app.use((error: unknown, _request: express.Request, response: express.Response, _next: express.NextFunction) => {
  const status = error instanceof PlanningError ? error.status : (error as { status?: number; type?: string })?.type === 'entity.parse.failed' ? 400 : 500;
  const message = error instanceof Error ? error.message : 'The local dashboard could not complete this request.';
  response.status(status).json({ error: message });
});
http.listen(port, '127.0.0.1', () => {
  console.log('Worktrail: http://127.0.0.1:' + port);
  console.log('Reading: ' + session.root);
  console.log('Local view statistics: ' + session.dataRoot);
});
for (const signal of ['SIGINT', 'SIGTERM'] as const) process.on(signal, () => {
  http.close(() => { session.close(); process.exit(0); });
});
