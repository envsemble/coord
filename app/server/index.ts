import express from 'express';
import { createServer } from 'node:http';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { existsSync } from 'node:fs';
import { realpath, stat } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import path from 'node:path';
import { loadPlanning, PlanningError, readDocument, resolveDocument } from './planning.ts';
import { Telemetry, recordCollectionGap } from './telemetry.ts';
import type { Usage } from '../src/types.ts';
import { cacheOutsidePlanning, statisticsDirectory } from './storage.ts';
import { localOrigin } from './origin.ts';
import { AtlasCatalog } from './atlas.ts';
import { createScopeCache } from './atlasScope.ts';

const { values } = parseArgs({ options: {
  dev: { type: 'boolean', default: false }, 'planning-dir': { type: 'string' }, 'atlas-dir': { type: 'string' }, port: { type: 'string', default: '4317' }, 'data-dir': { type: 'string' },
} });
const appRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const planningRoot = path.resolve(values['planning-dir'] ?? path.join(appRoot, '../../planning'));
const atlas = new AtlasCatalog(path.resolve(values['atlas-dir'] ?? planningRoot));
const planningIndex = createScopeCache(() => loadPlanning(planningRoot), async () => {
  const file = await stat(path.join(planningRoot, 'planning.json'));
  return file.mtimeMs + ':' + file.size;
});
const port = Number(values.port);
if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('Choose a valid --port.');
const dataRoot = await statisticsDirectory(planningRoot, values['data-dir'] ?? process.env.PLANNING_DASHBOARD_DATA_DIR);
let telemetry: Telemetry | null = null;
let collectionError: string | null = null;
let usageDirectory: string | null = null;
try {
  usageDirectory = await cacheOutsidePlanning(planningRoot, dataRoot);
  telemetry = new Telemetry(path.join(usageDirectory, 'usage.sqlite'));
}
catch { collectionError = 'Local usage collection is unavailable. Document viewing still works; statistics are unknown.'; }
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
app.get('/api/snapshot', async (_request, response) => {
  response.setHeader('Cache-Control', 'no-store');
  const unavailable = { dashboardSince: null, agentSince: null, views: 0, documentsViewed: 0, sessions: 0, reports: 0, documentsConsulted: 0, tasks: 0, unassigned: 0, failures: 0, documents: [] };
  const snapshot = await planningIndex(true);
  let usage: Usage = unavailable;
  const usageByRepository: Record<string, Usage> = Object.create(null);
  let currentCollectionError = collectionError;
  try {
    if (telemetry) {
      usage = telemetry.summary();
      for (const repository of snapshot.repositories) usageByRepository[repository.id] = telemetry.summary(snapshot.documents.filter(document => document.repositories.includes(repository.id)).map(document => document.key));
    }
  } catch { currentCollectionError = 'Local usage statistics could not be read. Document viewing still works; collection is incomplete.'; }
  response.json({ ...snapshot, usage, usageByRepository, collectionError: currentCollectionError });
});
app.get('/api/document', async (request, response) => {
  if (typeof request.query.path !== 'string') throw new PlanningError('Choose a document.');
  response.setHeader('Cache-Control', 'no-store');
  response.json(await readDocument(planningRoot, request.query.path));
});
for (const endpoint of ['models', 'model', 'references']) app.get('/api/atlas/' + endpoint, async (request, response) => {
  const work = typeof request.query.work === 'string' ? request.query.work : undefined;
  if (!work && endpoint !== 'references') throw new PlanningError('Choose a work item.');
  const snapshot = await planningIndex();
  response.setHeader('Cache-Control', 'no-store');
  if (endpoint === 'models') response.json(atlas.list(snapshot, work!));
  else if (endpoint === 'model') {
    if (typeof request.query.handle !== 'string') throw new PlanningError('Choose an Atlas model.');
    response.json(await atlas.prepared(snapshot, work!, request.query.handle));
  } else {
    if (typeof request.query.path !== 'string') throw new PlanningError('Choose an indexed document.');
    response.json(atlas.references(snapshot, work, request.query.path));
  }
});
app.get('/api/file', async (request, response) => {
  if (typeof request.query.path !== 'string') throw new PlanningError('Choose an attachment.');
  const filename = await resolveDocument(planningRoot, request.query.path);
  response.setHeader('Content-Security-Policy', "sandbox; default-src 'none'");
  response.setHeader('X-Content-Type-Options', 'nosniff');
  if (request.query.download === '1') response.download(filename);
  else response.sendFile(filename);
});
app.post('/api/events', async (request, response) => {
  const event = request.body as { id: string; path: string; session: string; contentHash?: string };
  if (typeof event?.path !== 'string') throw new PlanningError('Choose a document for this event.');
  const snapshot = await planningIndex();
  const document = snapshot.documents.find(file => file.path === event.path);
  if (!document) throw new PlanningError('This document is not in the connected planning folder.', 403);
  let revision: string | null = null;
  try { if (snapshot.gitAvailable) revision = (await promisify(execFile)('git', ['-C', planningRoot, 'rev-parse', 'HEAD'])).stdout.trim(); } catch { /* Unknown revision remains null. */ }
  const content = await readDocument(planningRoot, event.path);
  if (event.contentHash && content.contentHash !== event.contentHash) { response.status(409).json({ error: 'The document changed; refresh to record the current view.' }); return; }
  if (!telemetry) {
    if (usageDirectory) recordCollectionGap(usageDirectory, 'dashboard_view');
    throw new PlanningError('Local view collection is unavailable; document reading remains available.', 503);
  }
  telemetry.recordView({ ...event, key: document.key, revision, contentHash: content.contentHash || null });
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
  const status = error instanceof PlanningError ? error.status : 500;
  const message = error instanceof Error ? error.message : 'The local dashboard could not complete this request.';
  response.status(status).json({ error: message });
});
http.listen(port, '127.0.0.1', () => {
  console.log('Worktrail: http://127.0.0.1:' + port);
  console.log('Reading: ' + planningRoot);
  console.log('Local view statistics: ' + dataRoot);
});
for (const signal of ['SIGINT', 'SIGTERM'] as const) process.on(signal, () => {
  http.close(() => { telemetry?.close(); process.exit(0); });
});
