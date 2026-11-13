// The fixed list of messages a window may send. Each channel declares a validator per argument;
// calls with the wrong number or shape of arguments, from a subframe, or from a page that is not
// the Atlas renderer are rejected. Results and errors cross back as structured values. Requests
// about a project go to the host of the window's computer, this one or a paired one.
import { lstat, realpath, stat } from 'node:fs/promises';
import path from 'node:path';
import QRCode from 'qrcode';
import { app, BrowserWindow, clipboard, dialog, ipcMain, nativeTheme, shell, type IpcMainInvokeEvent } from 'electron';
import { HostRequestError, parsePairing, type HostClient } from '@envsemble/atlas/host';
import { resolveDocument } from '@envsemble/atlas/planning';
import { accessSettings, deviceText } from '@envsemble/atlas/host/validate';
import { agentNames, defaultUiState, fullPath, invokeChannels, limits, type AboutInfo, type AgentId, type AccessSettings, type Editor, type InvokeChannel, type LoadedUi, type PairingGrant, type Project, type PairingLinkView, type Place, type ProjectPlace, type ProjectChangeRequest, type ReferenceInput, type Result, type ThemePreference, type UiState } from '../../shared/contract.ts';
import { agentId, argumentsOf, array, boolean, command, diagramPath, editor, folderPath, integer, ipAddress, nullable, object, oneOf, optional, pairingCode, place, projectId, projectName, referenceInput, referenceInputs, relativePath, string, statisticsUnit, isoTime, themePreference, uiState, url, workId, type Validator } from '../../shared/validate.ts';
import { AtlasError, toErrorValue } from '../errors.ts';
import type { ProjectView } from '../computers/projectView.ts';
import type { Agents } from '../agent/agents.ts';
import { programFilters } from '../agent/programs.ts';
import { originOf, rendererOrigin } from './protocol.ts';
import { placeRow, savedPlace } from '../appState.ts';
import { externalUrl, type AtlasWindow } from './window.ts';
import type { WindowManager } from './windowManager.ts';
import { appLink, editorLink } from './launch.ts';

type Handler = (window: AtlasWindow, ...args: never[]) => unknown;
interface Channel { args: Validator<unknown>[]; handle: Handler }

const hostId = string({ min: 8, max: 64, pattern: /^[a-zA-Z0-9-]+$/ });
/** A computer: a paired one by its host ID, or null for this one. */
const computer = nullable(hostId);
const deviceId = string({ min: 34, max: 34, pattern: /^d-[a-f0-9]{32}$/ });
const pairingLink = string({ min: 3, max: 2048 });
const grant: Validator<PairingGrant> = object<PairingGrant>({ label: nullable(deviceText(80)), manageAccess: boolean });
const folders = array(folderPath, limits.folders);
const searchQuery = string({ min: 1, max: 200 });
const projectChange = object<ProjectChangeRequest>({ name: optional(projectName), state: optional(oneOf(['active', 'archived'] as const)), position: optional(integer(0, 100000)), folders: optional(folders) });

/** Reveal a file or folder inside a project's folder on this computer (never outside it, never hidden parts). */
async function revealInside(window: AtlasWindow, projectId: string, relative: string) {
  if (window.computer !== null) throw new AtlasError('forbidden', 'Files of a project on another computer cannot be shown in a folder here.');
  await window.readable(projectId);
  const root = (await window.projects()).find(entry => entry.id === projectId)?.path;
  if (!root) throw new AtlasError('not-found', 'This project is not on this computer.');
  try { shell.showItemInFolder(await resolveDocument(root, relative)); return; } catch { /* Perhaps a folder. */ }
  const base = await realpath(root);
  const candidate = await realpath(path.resolve(base, relative)).catch(() => null);
  const inside = candidate ? path.relative(base, candidate) : '..';
  if (!candidate || inside.startsWith('..') || path.isAbsolute(inside) || inside.split(path.sep).some(part => part.startsWith('.')) || !(await lstat(candidate)).isDirectory()) {
    throw new AtlasError('forbidden', 'Only files and folders inside the project\'s folder can be shown.');
  }
  shell.showItemInFolder(candidate);
}

/** What only this computer's projects allow: their files are on this computer. */
function thisComputer(window: AtlasWindow, what: string) {
  if (window.computer !== null) throw new AtlasError('forbidden', what + ' of a project on another computer cannot be opened here.');
}

/**
 * Open a file or folder on this computer in the chosen editor, at its line, after asking (`what`:
 * "this file") unless the person opens what the window shows themselves (`ask` false). With the
 * system's application chosen it is only shown in its folder: opening it would run a script or a
 * program a plan names.
 */
async function openInEditor(manager: WindowManager, window: AtlasWindow, what: string, file: string, line: number | null, ask = true) {
  const choice: Editor = manager.context.state.editor;
  const link = editorLink(choice, file, line);
  const detail = file + (line ? ':' + line : '');
  if (!link) {
    if (ask) await confirmed(window, 'Show ' + what + ' in its folder?', 'Show', detail);
    shell.showItemInFolder(file);
    return;
  }
  if (ask) await confirmed(window, 'Open ' + what + ' in your editor?', 'Open', detail);
  await shell.openExternal(link);
}

/** Whether a path is a folder or inside it (both real paths): the way there starts with no `..` segment (a folder named `..cache` is inside). */
const within = (folder: string, candidate: string) => {
  const inside = path.relative(folder, candidate);
  return !path.isAbsolute(inside) && inside.split(path.sep)[0] !== '..';
};

/** Open the file a path reference names, as the host resolves it in the project's folders: never a path the page names itself. */
async function openReference(manager: WindowManager, window: AtlasWindow, projectId: string, reference: ReferenceInput) {
  thisComputer(window, 'Files');
  if (reference.kind !== 'path') throw new AtlasError('invalid-argument', 'Only a file reference opens in the editor.');
  const view = await window.readable(projectId);
  const [resolved] = await view.request('references.resolve', { projectId, items: [reference] });
  const file = resolved?.file;
  const missing = () => new AtlasError('not-found', 'This file is not in the project\'s folders on this computer.');
  if (!file || !fullPath.test(file.path)) throw missing();
  // The file itself, not a link a checkout commits to somewhere else: inside one of the project's
  // folders or its planning folder.
  const real = await realpath(file.path).catch(() => null);
  const listed = (await window.projects()).find(entry => entry.id === projectId);
  const folders = (await Promise.all([...listed?.folders ?? [], ...listed ? [listed.path] : []].map(folder => realpath(folder).catch(() => null)))).filter((folder): folder is string => folder !== null);
  if (!real || !folders.some(folder => within(folder, real)) || !(await stat(real)).isFile()) throw missing();
  await openInEditor(manager, window, 'this file', real, file.line);
}

/**
 * Open in: the file the window shows (`place`, which must be the place the page last saved as the
 * one it shows) in the editor, without asking, as the person opens it themselves. The file must be of
 * that place (the file itself, or a file of the plan shown) and is resolved inside the project's
 * folder (never a link out of it, never a hidden part). A file a page's content names opens through
 * openReference, which asks.
 */
async function openShown(manager: WindowManager, window: AtlasWindow, shown: Place, relative: string) {
  thisComputer(window, 'Files');
  const refused = () => new AtlasError('forbidden', 'Only the file the window shows opens this way.');
  if ('page' in shown || !window.shown || 'page' in window.shown || !sameShown(shown, window.shown)) throw refused();
  const { projectId, target } = shown;
  const view = await window.readable(projectId);
  if (target.kind === 'file' ? target.path !== relative : !(await view.request('project.work', { projectId })).some(work => work.id === target.work && relative.startsWith(work.path + '/'))) throw refused();
  const root = (await window.projects()).find(entry => entry.id === projectId)?.path;
  if (!root) throw new AtlasError('not-found', 'This project is not on this computer.');
  const real = await resolveDocument(root, relative).catch(() => { throw new AtlasError('forbidden', 'Only files inside the project\'s folder open in the editor.'); });
  await openInEditor(manager, window, 'this file', real, null, false);
}
/** Whether two places of a project show the same thing (where in it aside). */
function sameShown(a: ProjectPlace, b: ProjectPlace) {
  const key = ({ projectId, target }: ProjectPlace) => JSON.stringify([projectId, target.kind, 'work' in target ? target.work : null, 'path' in target ? target.path : null]);
  return key(a) === key(b);
}

/** A command a page could misuse runs after a person's press, or once they confirm it. */
async function confirmed(window: AtlasWindow, message: string, action: string, detail?: string) {
  if (!(await window.confirm(message, action, detail))) throw new AtlasError('cancelled', 'Cancelled.');
}
/** The computer pairing would reach, read from the link as pairing reads it. A link that cannot pair fails here, before the question. */
function pairingHost(link: string, code: string | null) {
  try { return new URL(parsePairing(link, code ?? undefined).origin).host; } catch (error) { throw hostError(error); }
}

/**
 * A window's layout as the database keeps it: the shared settings and the place it showed of its
 * computer's projects (with none, the hub). A
 * paired computer that is not connected is not waited for: the window shows the hub, its place of a
 * project not listed yet waits in the database (`pending`), and the window asks again once the
 * computer answers.
 */
async function loadUi(manager: WindowManager, window: AtlasWindow): Promise<LoadedUi> {
  const { state, computers } = manager.context;
  const computerId = window.computer === null ? null : computers.idOf(window.computer);
  // Earlier saves land first, so what loads is what the window last showed.
  await saving.get(window);
  let listed: Project[] | null = null;
  const listing = window.projects().then(projects => { listed = projects; }, () => undefined);
  // A paired computer that does not answer at once is not waited for.
  await (window.computer === null || window.client().status === 'connected' ? listing : Promise.race([listing, new Promise(resolve => setTimeout(resolve, 2000))]));
  // The window now knows the saved places of the projects listed, and saves replace only theirs.
  for (const rowId of window.listedRows()) window.placesLoaded.add(rowId);
  const saved = state.places(window.rowId, computerId).find(row => row.active);
  const shownProject = saved ? window.projectIdOfRow(saved.projectRowId) : null;
  const place = saved && shownProject ? savedPlace(shownProject, saved) : null;
  const inspectorWidth = state.inspectorWidth;
  // The window starts from this listing rather than asking for its own.
  const projects = listed as Project[] | null;
  return { place: place ?? defaultUiState.place, ...inspectorWidth !== null && { inspectorWidth }, ...state.filesHidden && { filesHidden: true }, ...saved && !shownProject && { pending: true }, ...projects && { projects } };
}
/** Each window's saves, applied one after another in the order they came. */
const saving = new WeakMap<AtlasWindow, Promise<void>>();
function queueSave(manager: WindowManager, window: AtlasWindow, ui: UiState) {
  const next = (saving.get(window) ?? Promise.resolve()).then(() => saveUi(manager, window, ui));
  saving.set(window, next.catch(() => undefined));
  return next;
}
/** Save a window's layout: its place replaces the saved places of the projects it loaded them for; the others' stay. */
async function saveUi(manager: WindowManager, window: AtlasWindow, ui: UiState) {
  const { state, computers } = manager.context;
  const computer = window.computer;
  state.setInspectorWidth(ui.inspectorWidth ?? null);
  state.setFilesHidden(ui.filesHidden ?? false);
  const row = placeRow(ui.place);
  const projectRowId = row ? window.listedRow(row.projectId) : null;
  const rows = row && projectRowId !== null ? [{ projectRowId, kind: row.kind, target: row.target, active: true }] : [];
  // A project listed since the layout loaded (made meanwhile) has its place replaced from now on too.
  if (projectRowId !== null) window.placesLoaded.add(projectRowId);
  // The window may have moved to another computer meanwhile: this place is no longer its own.
  if (window.computer === computer) state.savePlaces(window.rowId, computer === null ? null : computers.idOf(computer), rows, [...window.placesLoaded]);
}

/** What the message handlers need from the app beyond the windows. */
export interface IpcActions { openLogs(): void; about(): AboutInfo; agents: Agents }

function channels(manager: WindowManager, actions: IpcActions): Record<InvokeChannel, Channel> {
  const { computers } = manager.context;
  const owner = (): HostClient => computers.local;
  return {
    'window:info': { args: [], handle: window => window.info() },
    'projects:list': { args: [], handle: window => remoteErrors(window.projects()) },
    // The host's search of every active project; a paired computer's host searches its own.
    'search:query': {
      args: [searchQuery],
      handle: async (window, query: string) => {
        const computer = window.computer;
        const results = await remoteErrors(window.client().request('search.query', { query, limit: 50 }, { timeout: 20000 }));
        if (computer === null) return results;
        // This app keeps its own archived state for another computer's projects: their results go.
        const active = await window.activeProjects();
        return results.filter(result => active.has(result.projectId));
      },
    },
    'projects:create': { args: [projectName, folders], handle: (window, name: string, folders: string[]) => remoteErrors(window.createProject(name, folders)) },
    'projects:chooseFolder': {
      args: [],
      handle: async window => {
        if (window.computer !== null) throw new AtlasError('unavailable', 'A folder on another computer cannot be chosen here: type its path.');
        const choice = await window.oneDialog(() => dialog.showOpenDialog(window.win, { title: 'Choose a folder', buttonLabel: 'Choose', properties: ['openDirectory', 'createDirectory'] }));
        return choice.canceled ? null : choice.filePaths[0] ?? null;
      },
    },
    'projects:update': { args: [projectId, projectChange], handle: (window, projectId: string, change: ProjectChangeRequest) => remoteErrors(window.updateProject(projectId, change)) },
    'project:open': { args: [projectId], handle: async (window, projectId: string) => (await window.open(projectId)).change() },
    'project:close': { args: [projectId], handle: (window, projectId: string) => { window.closeProject(projectId); } },
    'project:snapshot': { args: [projectId], handle: async (window, projectId: string) => (await window.readable(projectId)).request('project.snapshot', { projectId }) },
    'project:work': { args: [projectId], handle: async (window, projectId: string) => (await window.readable(projectId)).request('project.work', { projectId }) },
    'project:document': { args: [projectId, relativePath], handle: async (window, projectId: string, file: string) => (await window.readable(projectId)).request('project.document', { projectId, path: file }) },
    'project:diagrams': { args: [projectId, workId], handle: async (window, projectId: string, work: string) => (await window.readable(projectId)).request('project.diagrams', { projectId, work }) },
    'project:diagram': { args: [projectId, workId, diagramPath], handle: async (window, projectId: string, work: string, file: string) => (await window.readable(projectId)).request('project.diagram', { projectId, work, path: file }) },
    'project:references': { args: [projectId, nullable(workId), relativePath], handle: async (window, projectId: string, work: string | null, file: string) => (await window.readable(projectId)).request('project.references', { projectId, work, path: file }) },
    'project:diagramIndex': { args: [projectId], handle: async (window, projectId: string) => (await window.readable(projectId)).request('project.diagramIndex', { projectId }) },
    // What a planning file references, a work item's sessions and its time, from the project's computer.
    'references:resolve': { args: [projectId, referenceInputs], handle: async (window, projectId: string, items: ReferenceInput[]) => remoteErrors((await window.readable(projectId)).request('references.resolve', { projectId, items }, { timeout: 30000 })) },
    'work:sessions': { args: [projectId, workId], handle: async (window, projectId: string, work: string) => remoteErrors((await window.readable(projectId)).request('work.sessions', { projectId, work })) },
    'work:timeline': { args: [projectId, workId], handle: async (window, projectId: string, work: string) => remoteErrors((await window.readable(projectId)).request('work.timeline', { projectId, work })) },
    // A project's statistics for a period, from the project's computer.
    'project:statistics': { args: [projectId, nullable(isoTime), nullable(isoTime), statisticsUnit], handle: async (window, projectId: string, from: string | null, to: string | null, unit: 'day' | 'week') => remoteErrors((await window.readable(projectId)).request('project.statistics', { projectId, from, to, unit }, { timeout: 30000 })) },
    // All plans: the projects this window's computer has active, as the app keeps them.
    'projects:statistics': { args: [nullable(isoTime), nullable(isoTime), statisticsUnit], handle: async (window, from: string | null, to: string | null, unit: 'day' | 'week') => remoteErrors(window.client().request('projects.statistics', { projectIds: [...await window.activeProjects()], from, to, unit }, { timeout: 30000 })) },
    'ui:load': { args: [], handle: window => loadUi(manager, window) },
    'ui:save': { args: [uiState], handle: (window, state: UiState) => { window.shown = state.place; return queueSave(manager, window, state); } },
    'shell:reveal': { args: [projectId, relativePath], handle: (window, projectId: string, file: string) => revealInside(window, projectId, file) },
    'shell:openExternal': {
      args: [url],
      handle: async (window, value: string) => {
        const external = externalUrl(value);
        // An application's link opens an application of this computer: only with a scheme on the allowlist, only for this computer's projects.
        const application = external ? null : appLink(value);
        if (!external && !application) throw new AtlasError('forbidden', 'Only web and mail links, and links of applications Atlas knows, open outside Atlas.');
        if (application) thisComputer(window, 'Links of applications');
        await confirmed(window, application ? 'Open this link in its application?' : 'Open this address in your browser?', 'Open', external ?? application!);
        await shell.openExternal(external ?? application!);
      },
    },
    'shell:openReference': { args: [projectId, referenceInput], handle: (window, projectId: string, reference: ReferenceInput) => openReference(manager, window, projectId, reference) },
    'shell:openShown': { args: [place, relativePath], handle: (window, shown: Place, file: string) => openShown(manager, window, shown, file) },
    'shell:copy': { args: [string({ min: 1, max: 10000 })], handle: (_window, text: string) => { clipboard.writeText(text); } },
    'app:theme': { args: [], handle: () => manager.context.state.theme },
    // Every window follows the native theme through prefers-color-scheme, so one change reaches them all.
    'app:setTheme': { args: [themePreference], handle: (_window, preference: ThemePreference) => { manager.context.state.setTheme(preference); nativeTheme.themeSource = preference; } },
    // The editor is one of a fixed list (each opened through its own link), so choosing one runs nothing.
    'app:editor': { args: [], handle: () => manager.context.state.editor },
    'app:setEditor': { args: [editor], handle: (_window, choice: Editor) => { manager.context.state.setEditor(choice); } },
    // About Atlas, which the window shows: versions and the data folder, nothing a page could misuse.
    'app:about': { args: [], handle: () => actions.about() },
    'app:command': {
      args: [command],
      handle: async (window, name: string) => {
        const contents = window.win.webContents;
        const devTools = manager.context.devTools;
        switch (name) {
          // A page cannot open windows without end, quit or pile up
          // dialogs: these follow a person's press or their answer to Atlas's question.
          case 'newWindow': await confirmed(window, 'Open a new Atlas window?', 'Open'); manager.create(window.computer); return;
          case 'quit': await confirmed(window, 'Exit Atlas?', 'Exit'); app.quit(); return;
          case 'openLogs': await confirmed(window, 'Open the folder with Atlas’s logs?', 'Open'); actions.openLogs(); return;
          case 'zoomIn': window.zoom('in'); return;
          case 'zoomOut': window.zoom('out'); return;
          case 'resetZoom': window.zoom('reset'); return;
          case 'toggleFullScreen': window.win.setFullScreen(!window.win.isFullScreen()); return;
          case 'reload': if (devTools) contents.reload(); return;
          case 'toggleDevTools': if (devTools) contents.toggleDevTools(); return;
        }
      },
    },
    'computers:list': { args: [], handle: () => computers.computers() },
    'computers:switch': {
      args: [computer, boolean],
      handle: async (window, id: string | null, newWindow: boolean) => {
        if (id !== null && !computers.has(id)) throw new AtlasError('not-found', 'This computer is not paired. Connect to it again.');
        if (newWindow) await confirmed(window, 'Open that computer in a new window?', 'Open');
        manager.switchComputer(window, id, newWindow);
      },
    },
    'computers:pair': {
      args: [pairingLink, nullable(pairingCode)],
      handle: async (window, link: string, code: string | null) => {
        await confirmed(window, `Pair with the Atlas at ${pairingHost(link, code)}?`, 'Pair', 'This app can then work on that computer\'s projects.');
        const paired = await remoteErrors(computers.pair(link, code ?? undefined));
        // Windows already showing this computer read through the new pairing.
        manager.rebindComputer(paired.hostId!);
        return paired;
      },
    },
    'computers:forget': { args: [hostId], handle: (_window, id: string) => manager.forgetComputer(id) },
    // Remote access of a computer: this one's (settings too), or a paired one's when this app may manage access there.
    'access:state': { args: [computer], handle: (_window, id: string | null) => remoteErrors(computers.use(id, client => client.request('access.state', {}))) },
    'access:update': {
      args: [accessSettings],
      handle: async (window, settings: AccessSettings) => {
        // Turning remote access on, or moving it to another address, changes who can reach this
        // computer; another port does not. The press counts from when the change came: reading the
        // state may wait for Tailscale.
        const pressed = window.takeActivation();
        const current = (await owner().request('access.state', {})).settings.network;
        const next = settings.network;
        if (next.enabled && (!current.enabled || next.address !== current.address) && !pressed
          && !(await window.ask(`Let paired devices reach this computer${next.address ? ' at ' + next.address : ''}?`, 'Allow'))) throw new AtlasError('cancelled', 'Cancelled.');
        return owner().request('access.update', { settings: settings as never });
      },
    },
    'access:pairingCreate': {
      args: [computer, nullable(ipAddress), grant],
      handle: async (window, id: string | null, address: string | null, granted: PairingGrant): Promise<PairingLinkView> => {
        // A computer no longer paired fails here, before the question.
        if (id !== null && !computers.has(id)) throw new AtlasError('not-found', 'This computer is not paired. Connect to it again.');
        const detail = granted.manageAccess ? 'A device that uses it can work on the projects and manage who else has access.' : 'A device that uses it can work on the projects.';
        if (!(await window.ask(`Create a pairing link for ${id === null ? 'this computer' : computers.name(id)}?`, 'Create', detail))) throw new AtlasError('cancelled', 'Cancelled.');
        const link = await remoteErrors(computers.use(id, client => client.request('access.pairingCreate', { address, ...granted })));
        const qrSvg = link.url ? await QRCode.toString(link.url, { type: 'svg', errorCorrectionLevel: 'M', margin: 1, color: { dark: '#000000', light: '#ffffff' } }) : null;
        return { ...link, qrSvg };
      },
    },
    'access:pairingRevoke': { args: [computer, pairingCode], handle: (_window, id: string | null, code: string) => remoteErrors(computers.use(id, client => client.request('access.pairingRevoke', { code }))) },
    'access:devices': { args: [computer], handle: (_window, id: string | null) => remoteErrors(computers.use(id, client => client.request('access.devices', {}))) },
    'access:deviceRevoke': { args: [computer, deviceId], handle: (_window, id: string | null, device: string) => remoteErrors(computers.use(id, client => client.request('access.deviceRevoke', { deviceId: device }))) },
    // The agents of this computer, whatever computer the window shows. Connecting installs Atlas's
    // own plugin, which the app carries, and reaches no one else, so it needs no question.
    'agents:list': { args: [], handle: () => actions.agents.list() },
    'agents:checks': { args: [], handle: () => actions.agents.checks() },
    'agents:connect': { args: [agentId], handle: (_window, id: AgentId) => actions.agents.connect(id) },
    'agents:disconnect': { args: [agentId], handle: (_window, id: AgentId) => actions.agents.disconnect(id) },
    // An agent's program is a file chosen here, in main's own dialog: a window names only the agent,
    // never a path to run.
    'agents:chooseProgram': {
      args: [agentId],
      handle: async (window, id: AgentId) => {
        const choice = await window.oneDialog(() => dialog.showOpenDialog(window.win, { title: `Choose the ${agentNames[id]} program`, buttonLabel: 'Choose', properties: ['openFile'], filters: programFilters(id) }));
        const program = choice.canceled ? undefined : choice.filePaths[0];
        return program ? actions.agents.setProgram(id, program) : null;
      },
    },
    'agents:clearProgram': { args: [agentId], handle: (_window, id: AgentId) => actions.agents.clearProgram(id) },
    'agents:byHand': { args: [], handle: () => actions.agents.byHand() },
    'onboarding:state': { args: [], handle: () => actions.agents.onboarding() },
    'onboarding:finish': { args: [], handle: () => actions.agents.finishOnboarding() },
  };
}

/** A paired computer's errors as the window shows them (a refused credential is "forbidden" there). */
async function remoteErrors<T>(pending: Promise<T>): Promise<T> {
  try { return await pending; } catch (error) { throw hostError(error); }
}
function hostError(error: unknown) {
  return error instanceof HostRequestError ? new AtlasError(error.code === 'unauthorized' ? 'forbidden' : error.code, error.message) : error;
}

/** Accept only the Atlas renderer's own top-level frame. */
function trustedSender(event: IpcMainInvokeEvent, manager: WindowManager): AtlasWindow | null {
  const frame = event.senderFrame;
  if (!frame || frame.parent !== null) return null;
  const owner = BrowserWindow.fromWebContents(event.sender);
  const window = owner ? manager.fromId(owner.id) : undefined;
  if (!window) return null;
  const expected = originOf(manager.context.devUrl ?? rendererOrigin);
  return expected !== null && originOf(frame.url) === expected ? window : null;
}

export function registerIpc(manager: WindowManager, actions: IpcActions) {
  const table = channels(manager, actions);
  for (const name of invokeChannels) {
    const channel = table[name];
    ipcMain.handle(name, async (event, ...values: unknown[]): Promise<Result<unknown>> => {
      const window = trustedSender(event, manager);
      if (!window) {
        manager.context.log.warn('Rejected a message from an untrusted sender', { channel: name });
        return { ok: false, error: { code: 'forbidden', message: 'This window may not send that message.' } };
      }
      try {
        const args = argumentsOf(channel.args, values);
        return { ok: true, value: await (channel.handle as (window: AtlasWindow, ...args: unknown[]) => unknown)(window, ...args) ?? null };
      } catch (error) {
        const { value, expected } = toErrorValue(error);
        // A window saves its layout on its own and does not show a failure, so the log does.
        manager.context.log.write(!expected ? 'error' : name === 'ui:save' ? 'warn' : 'info', 'Request failed: ' + name, expected ? value : error);
        return { ok: false, error: value };
      }
    });
  }
}
