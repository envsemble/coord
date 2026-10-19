// What a planning file references, as links in the reader's own style: resolved by the host in one
// batch per document, once it shows, and linked only when they lead somewhere. A PR shows its state
// beside it; a commit in several repositories offers the choice; a file opens in the editor and an
// application's link in its application, on this computer only (their paths are the host's).
import { createContext, useContext, useEffect, useState, type MouseEvent, type ReactNode } from 'react';
import { Menu, MenuItem } from '@envsemble/envui';
import { CallMerge } from '@envsemble/envui/icons/CallMerge';
import { CallSplit } from '@envsemble/envui/icons/CallSplit';
import { Cancel } from '@envsemble/envui/icons/Cancel';
import { CheckCircle } from '@envsemble/envui/icons/CheckCircle';
import { Pending } from '@envsemble/envui/icons/Pending';
import type { ReferenceInput, ResolvedReference } from '../types';
import { api } from '../api';
import { workTarget } from '../navigation/targets';
import { referenceKey, type Found } from './references';
import { useWorkbench } from './workbenchContext';

/** The host's answers for a document's references, by their key: an answer, null for none, absent while it is asked. */
export type Resolutions = ReadonlyMap<string, ResolvedReference | null>;

/** How many references the host resolves in one request (its own limit). */
const batch = 500;
/** Resolve a document's references once it shows, in batches; asked again only when they change. */
export function useResolvedReferences(work: string | null, inputs: ReferenceInput[]): Resolutions {
  const { project } = useWorkbench();
  const [resolved, setResolved] = useState<Resolutions>(new Map());
  const key = inputs.map(referenceKey).join('\n');
  useEffect(() => {
    if (!inputs.length) { setResolved(new Map()); return; }
    let current = true;
    const chunks = Array.from({ length: Math.ceil(inputs.length / batch) }, (_, index) => inputs.slice(index * batch, (index + 1) * batch));
    for (const chunk of chunks) {
      api.resolveReferences(project, work, chunk).then(answers => {
        if (!current) return;
        setResolved(previous => new Map([...previous, ...chunk.map((input, index) => [referenceKey(input), answers[index] ?? null] as const)]));
      }, () => undefined);
    }
    return () => { current = false; };
  }, [project, work, key]);
  return resolved;
}

export const ReferencesContext = createContext<{ resolved: Resolutions; work: string | null }>({ resolved: new Map(), work: null });

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
  return <a href="#" title={title} onClick={(event: MouseEvent) => { event.preventDefault(); run(); }}>{children}</a>;
}

/** A reference the reader found: a link once it leads somewhere, plain text until then or when it leads nowhere. */
export function ReferenceLink({ found, children }: { found: Found; children: ReactNode }) {
  const { open, notify, remote, snapshot, project } = useWorkbench();
  const { resolved, work } = useContext(ReferencesContext);
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
    if (answer.file && !remote) return <Action run={() => { api.openReference(project, work, input).catch(failed); }} title={'Open in your editor: ' + answer.file.path + (answer.file.line ? ':' + answer.file.line : '')}>{children}</Action>;
    return answer.url ? <Action run={() => openUrl(answer.url!)} title={answer.url}>{children}</Action> : <>{children}</>;
  }
  if (input.kind === 'commit' && answer.choices.length) {
    const options = [{ repository: answer.repository ?? 'This repository', url: answer.url, title: answer.title }, ...answer.choices];
    return <Menu aria-label="The commit in which repository" density="compact" trigger={<a href="#" title="In more than one repository" onClick={event => event.preventDefault()}>{children}</a>}>
      {options.map(option => <MenuItem key={option.repository} disabled={!option.url} description={option.title ?? undefined} onClick={() => option.url && openUrl(option.url)}>{option.repository}</MenuItem>)}
    </Menu>;
  }
  if (!answer.url) return <>{children}</>;
  return <><Action run={() => openUrl(answer.url!)} title={answer.pull?.title ?? answer.title ?? answer.url}>{children}</Action>{answer.pull && <PullMark pull={answer.pull} />}</>;
}
