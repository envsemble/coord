// The Atlas host, run by the desktop app in an Electron utility process (main/host/localHost.ts starts
// it). The app sends its settings over the private parent port and gets back the loopback port and
// the owner token, which never touch disk or the command line. The windows' requests reach the
// host through the app's main process, over the same authenticated connection a paired device uses.
import path from 'node:path';
import { Host } from '@envsemble/atlas/host';
import createPlanWorker from './planWorker.ts?nodeWorker';
import { RotatingLog } from '../log.ts';
// The planning templates new projects are made from, as the atlas skill bundles them.
import agents from '../../../packages/atlas/templates/planning/AGENTS.md?raw';
import plans from '../../../packages/atlas/templates/planning/PLANS.md?raw';
import readme from '../../../packages/atlas/templates/planning/README.md?raw';
import frontmatter from '../../../packages/atlas/templates/planning/plan-frontmatter.md?raw';
import registry from '../../../packages/atlas/templates/planning/planning.json?raw';
import attributes from '../../../packages/atlas/templates/planning/.gitattributes?raw';

const templates = { 'AGENTS.md': agents, 'PLANS.md': plans, 'README.md': readme, 'plan-frontmatter.md': frontmatter, 'planning.json': registry, '.gitattributes': attributes };

export interface HostStartMessage { type: 'start'; home: string; version: string; loopbackPort: number }
export type HostProcessMessage = { type: 'ready'; port: number; ownerToken: string; hostId: string } | { type: 'failed'; message: string };

const parent = (process as unknown as { parentPort: { on(event: 'message', listener: (event: { data: unknown }) => void): void; postMessage(message: HostProcessMessage): void } }).parentPort;
let host: Host | null = null;

parent.on('message', ({ data }) => {
  const message = data as HostStartMessage | { type: 'stop' };
  if (message?.type === 'stop') { void (host?.stop() ?? Promise.resolve()).finally(() => process.exit(0)); return; }
  if (message?.type !== 'start' || host) return;
  const log = new RotatingLog(path.join(message.home, 'logs'), { name: 'host' });
  process.on('uncaughtException', error => log.error('Uncaught exception', error));
  process.on('unhandledRejection', error => log.error('Unhandled rejection', error));
  host = new Host({ home: message.home, version: message.version, log, owner: 'the Atlas app', createPlanWorker: () => createPlanWorker({}), loopbackPort: message.loopbackPort, templates: async () => templates });
  host.start().then(
    ({ port }) => parent.postMessage({ type: 'ready', port, ownerToken: host!.ownerToken, hostId: host!.descriptor.hostId }),
    error => { log.error('Host could not start', error); parent.postMessage({ type: 'failed', message: (error as Error).message }); },
  );
});

// A signal (the app was killed) still stops cleanly where the platform delivers one.
process.on('SIGTERM', () => { void (host?.stop() ?? Promise.resolve()).finally(() => process.exit(0)); });
