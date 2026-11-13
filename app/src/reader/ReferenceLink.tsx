// What a planning file references, as links in the reader's own style: resolved by the host in one
// batch per document, once it shows, and linked only when they lead somewhere. A PR shows its state
// beside it; a file opens in the editor and an application's link in its application, on this
// computer only (their paths are the host's).
import { createContext, useContext, useEffect, useLayoutEffect, useRef, useState, type MouseEvent, type ReactNode } from 'react';
import { Link } from '@envsemble/envui';
import { IconCallMerge as CallMerge } from '@envsemble/envui/icons/CallMerge';
import { IconCallSplit as CallSplit } from '@envsemble/envui/icons/CallSplit';
import { IconCancel as Cancel } from '@envsemble/envui/icons/Cancel';
import { IconCheckCircle as CheckCircle } from '@envsemble/envui/icons/CheckCircle';
import { IconPending as Pending } from '@envsemble/envui/icons/Pending';
import type { ReferenceInput, ResolvedReference } from '../types';
import { api } from '../api';
import { workTarget } from '../navigation/targets';
import { referenceKey, type Collected, type Found } from './references';
import { useWindow } from '../window/windowContext';

/** The host's answers for a document's references, by their key: an answer, null for none, absent while it is asked. */
export type Resolutions = ReadonlyMap<string, ResolvedReference | null>;

/**
 * What a rendering collects for the host to resolve (`collected`, for `rehypeReferences`), and the
 * references it found, taken once it has rendered and kept while they stay the same.
 */
export function useCollectedReferences() {
  const collected = useRef<Collected>({ inputs: new Map() }).current;
  const [inputs, setInputs] = useState<ReferenceInput[]>([]);
  useLayoutEffect(() => {
    const next = [...collected.inputs.values()];
    if (next.map(referenceKey).join('\n') !== inputs.map(referenceKey).join('\n')) setInputs(next);
  });
  return { collected, inputs };
}

/** How many references the host resolves in one request (its own limit). */
const batch = 500;
/** How long before the host is asked once more about PRs whose state it did not have yet (it fetches them meanwhile). */
const pullRetry = 4000;
/**
 * Resolve a document's references once it shows, in batches; asked again only when they change, and
 * once more for PRs whose state the host was still fetching.
 */
export function useResolvedReferences(inputs: ReferenceInput[]): Resolutions {
  const { projectId } = useWindow();
  const [resolved, setResolved] = useState<Resolutions>(new Map());
  const key = inputs.map(referenceKey).join('\n');
  useEffect(() => {
    if (!inputs.length) { setResolved(new Map()); return; }
    let current = true;
    const timers: number[] = [];
    const ask = (items: ReferenceInput[], again: boolean) => api.resolveReferences(projectId, items).then(answers => {
      if (!current) return;
      setResolved(previous => new Map([...previous, ...items.map((input, index) => [referenceKey(input), answers[index] ?? null] as const)]));
      const pending = items.filter((input, index) => input.kind === 'pull' && answers[index]?.url && !answers[index]?.pull);
      if (again && pending.length) timers.push(window.setTimeout(() => { void ask(pending, false); }, pullRetry));
    }, () => undefined);
    for (let index = 0; index < inputs.length; index += batch) void ask(inputs.slice(index, index + batch), true);
    return () => { current = false; timers.forEach(timer => window.clearTimeout(timer)); };
  }, [projectId, key]);
  return resolved;
}

export const ReferencesContext = createContext<{ resolved: Resolutions }>({ resolved: new Map() });

const pullStates = { open: 'Open', draft: 'Draft', merged: 'Merged', closed: 'Closed' } as const;
const checkStates = { passing: 'checks passing', failing: 'checks failing', pending: 'checks running' } as const;
/** A PR's state as a small mark: open, draft, merged or closed, and its checks when they fail or run. */
export function PullMark({ pull }: { pull: NonNullable<ResolvedReference['pull']> }) {
  const label = [pullStates[pull.state], pull.checks && checkStates[pull.checks]].filter(Boolean).join(', ');
  const Icon = pull.state === 'merged' ? CallMerge : pull.state === 'closed' ? Cancel : CallSplit;
  const Checks = pull.checks === 'failing' ? Cancel : pull.checks === 'pending' ? Pending : pull.checks === 'passing' ? CheckCircle : null;
  return <span className="pull-mark" role="img" aria-label={label} title={label}>
    <Icon className="pull-mark-state" data-state={pull.state} />{Checks && <Checks className="pull-mark-checks" data-checks={pull.checks!} />}
  </span>;
}

/** A link of the reader's own: an anchor that runs its action instead of leaving. */
function Action({ run, title, children }: { run(): void; title?: string; children: ReactNode }) {
  return <Link href="#" title={title} onClick={(event: MouseEvent) => { event.preventDefault(); run(); }}>{children}</Link>;
}

/** A reference the reader found: a link once it leads somewhere, plain text until then or when it leads nowhere. */
export function ReferenceLink({ found, children }: { found: Found; children: ReactNode }) {
  const { open, notify, remote, snapshot, projectId } = useWindow();
  const { resolved } = useContext(ReferencesContext);
  const failed = (error: Error) => notify(error.message, 'warning');
  const openUrl = (url: string) => { api.openExternal(url).catch(failed); };
  if (found.kind === 'work') {
    const item = snapshot.work.find(entry => entry.id === found.work);
    return item ? <Action run={() => open(workTarget(item.id))} title={item.title}>{children}</Action> : <>{children}</>;
  }
  // An application's link opens an application of this computer.
  if (found.kind === 'app') return remote ? <>{children}</> : <Action run={() => openUrl(found.url)} title="Opens in its application">{children}</Action>;
  const answer = resolved.get(referenceKey(found.input));
  if (!answer) return <>{children}</>;
  const { input } = found;
  if (input.kind === 'path') {
    if (answer.file && !remote) return <Action run={() => { api.openReference(projectId, input).catch(failed); }} title={'Open in your editor: ' + answer.file.path + (answer.file.line ? ':' + answer.file.line : '')}>{children}</Action>;
    return answer.url ? <Action run={() => openUrl(answer.url!)} title={answer.url}>{children}</Action> : <>{children}</>;
  }
  if (!answer.url) return <>{children}</>;
  return <><Action run={() => openUrl(answer.url!)} title={answer.pull?.title ?? answer.title ?? answer.url}>{children}</Action>{answer.pull && <PullMark pull={answer.pull} />}</>;
}
