// `@envsemble/coord-page`: what a page imports to work with Coord. Its files and others in the
// planning folder (read and write), the user's choices, the Coord tools agents use, and the work
// item's diagrams. Paths are relative to the page's folder, or to the planning folder when they
// start with `/`. The frame (frame.tsx) connects it to the window before the page runs.
import { lazy, Suspense, useCallback, useEffect, useState, type ReactNode } from 'react';
import { Alert, Spinner, useTheme } from '@envsemble/envui';
import { planningPath, type PageInfo, type Request } from './pageMessages';

interface Channel {
  page: PageInfo;
  request(method: Request['method'], params: Request['params']): Promise<unknown>;
  /** Called with the planning-folder paths that changed; returns the unsubscribe. */
  subscribe(listener: (paths: string[]) => void): () => void;
}
let channel: Channel | null = null;
/** The frame's connection to its window; set once, before the page runs. */
export function connect(next: Channel) { channel = next; }
function connected(): Channel {
  if (!channel) throw new Error('This page is not open in Coord.');
  return channel;
}

/** The page: its name, folder, work item and project. */
export const page: PageInfo = new Proxy({} as PageInfo, { get: (_target, key) => connected().page[key as keyof PageInfo] });

/** A path a page gives, as a path in the planning folder; throws when it leaves the folder. */
export function resolve(path: string): string {
  const resolved = planningPath(connected().page.folder, path);
  if (!resolved) throw new Error(`${path} is outside the planning folder.`);
  return resolved;
}

/**
 * An address for a file of the planning folder, for an image, a video or a font to load directly:
 * `<img src={url('../../references/shot.png')} />`.
 */
export function url(path: string): string {
  return 'coord://planning/' + connected().page.project.id + '/' + resolve(path).split('/').map(encodeURIComponent).join('/');
}

/** A text file's contents. */
export async function read(path: string): Promise<string> { return await connected().request('read', { path: resolve(path) }) as string; }
/** A JSON file's value. */
export async function readJSON<T = unknown>(path: string): Promise<T> { return JSON.parse(await read(path)) as T; }
/** Write a text file (its folders are made). */
export async function write(path: string, content: string): Promise<void> { await connected().request('write', { path: resolve(path), content }); }
/** Write a value as a JSON file. */
export async function writeJSON(path: string, value: unknown): Promise<void> { await write(path, JSON.stringify(value, null, 2) + '\n'); }

/** An Coord tool's result, as agents call it: `tool('work_status', { work: 'work-0012' })`. A refusal throws. */
export async function tool<T = unknown>(name: string, input: Record<string, unknown> = {}): Promise<T> { return await connected().request('tool', { name, input }) as T; }

/** Open a file or page of the planning folder in Coord, in place of this page. */
export function open(path: string) { void connected().request('open', { path: resolve(path) }); }

/** Calls `listener` when files change (their planning-folder paths). */
export function onChange(listener: (paths: string[]) => void) { return connected().subscribe(listener); }

export interface FileState<T> { value: T | undefined; error: Error | null; loading: boolean }
function useRead<T>(path: string, parse: (text: string) => T): FileState<T> {
  const [state, setState] = useState<FileState<T>>({ value: undefined, error: null, loading: true });
  useEffect(() => {
    let current = true;
    const file = resolve(path);
    const load = () => read(path).then(text => { if (current) setState({ value: parse(text), error: null, loading: false }); },
      (error: unknown) => { if (current) setState({ value: undefined, error: error instanceof Error ? error : new Error(String(error)), loading: false }); });
    load();
    const stop = onChange(paths => { if (paths.includes(file)) load(); });
    return () => { current = false; stop(); };
    // `parse` is the caller's; the file is what is read.
  }, [path]);
  return state;
}
/** A text file, read again whenever it changes. */
export function useFile(path: string): FileState<string> { return useRead(path, text => text); }
/** A JSON file, read again whenever it changes. */
export function useJSON<T = unknown>(path: string): FileState<T> { return useRead(path, text => JSON.parse(text) as T); }

/** A choice as `choices.json` keeps it: the value chosen, when, and whether the agent closed it. */
export interface Choice<T = unknown> { value: T; chosenAt: string; closed?: boolean; note?: string }
export type Choices = Record<string, Choice>;
const choicesPath = 'choices.json';
async function currentChoices(): Promise<Choices> {
  try { return JSON.parse(await read(choicesPath)) as Choices; } catch { return {}; }
}
/** Every choice made on this page. */
export function useChoices(): Choices {
  const { value } = useRead<Choices>(choicesPath, text => JSON.parse(text) as Choices);
  return value ?? {};
}
/**
 * One choice on this page, by its key: what was chosen, whether the agent closed it (it is
 * settled), and `choose` to choose, which saves it in the page's `choices.json`, where the agent
 * reads it. A closed choice can't be changed.
 */
export function useChoice<T = unknown>(key: string): { value: T | undefined; closed: boolean; note: string | undefined; choose(value: T): Promise<void> } {
  const choices = useChoices();
  const choice = choices[key] as Choice<T> | undefined;
  const choose = useCallback(async (value: T) => {
    const latest = await currentChoices();
    if (latest[key]?.closed) throw new Error('This choice is closed.');
    await writeJSON(choicesPath, { ...latest, [key]: { value, chosenAt: new Date().toISOString() } });
  }, [key]);
  return { value: choice?.value, closed: Boolean(choice?.closed), note: choice?.note, choose };
}

// The diagram viewer loads only for a page that shows a diagram.
const DiagramPanel = lazy(() => Promise.all([import('@envsemble/coord-diagrams/react'), import('@envsemble/coord-diagrams/embedded.css')]).then(([module]) => ({ default: module.DiagramPanel })));

/** A diagram of the work item, as Coord draws it: `<Diagram path="../../diagrams/orders.puml" />`. */
export function Diagram({ path, height = '32rem', fallback }: { path: string; height?: string; fallback?: ReactNode }) {
  const { theme } = useTheme();
  const [state, setState] = useState<{ payload: unknown; error: string | null }>({ payload: null, error: null });
  useEffect(() => {
    let current = true;
    const file = resolve(path);
    const load = () => connected().request('diagram', { path: file }).then(payload => { if (current) setState({ payload, error: null }); },
      (error: unknown) => { if (current) setState({ payload: null, error: error instanceof Error ? error.message : String(error) }); });
    load();
    const stop = onChange(paths => { if (paths.includes(file)) load(); });
    return () => { current = false; stop(); };
  }, [path]);
  if (state.error) return <Alert tone="danger" title="This diagram can’t be shown">{state.error}</Alert>;
  const loading = fallback ?? <Spinner label="Loading the diagram" />;
  return <div className="coord-page-diagram" style={{ blockSize: height }}>
    {state.payload ? <Suspense fallback={loading}><DiagramPanel payload={state.payload as never} theme={theme} /></Suspense> : loading}
  </div>;
}
