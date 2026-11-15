// A plan's sessions, for its page: each agent session on it by its own title, with its harness,
// model and effort, its state, when it was last active and its agent time; and, while the plan needs
// the person, the waiting session's message. Read from the host as the plan's activity changes.
import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { Button, Link } from '@envsemble/envui';
import { Markdown } from '@envsemble/envui/markdown';
import type { WorkCommit, WorkSession, WorkTimeline } from '../types';
import { api } from '../api';
import { absoluteDate } from '../ui/format';
import { statuses } from './status';
import { StatusIcon } from '../ui/badges';
import { useWindow } from '../window/windowContext';
import { ReferenceLink, ReferencesContext, useCollectedReferences, useResolvedReferences } from '../reader/ReferenceLink';
import { rehypeReferences, wholeReference, type Found } from '../reader/references';
import type { Plugins } from '../reader/Reader';
import { harnessNames } from './sessions';
import type { LiveActivity } from './agentTime';

/** What changes when the plan's activity does: the sessions' states and since when. */
export const activityKey = (activity: LiveActivity | null) => activity ? activity.state + ':' + activity.sessions.map(session => session.session + session.state + session.since + (session.countsFrom ?? '')).join(',') : '';

/** A work item's sessions and the commits and PRs they made, read again when its activity (`key`) or its folder changes; null until read. */
export function useWorkSessions(work: string, key: string) {
  const { projectId, revision } = useWindow();
  const [value, setValue] = useState<{ work: string; sessions: WorkSession[]; commits: WorkCommit[] } | null>(null);
  useEffect(() => {
    let current = true;
    // Kept as it was when nothing changed, so the page does not draw it again.
    const set = (next: { work: string; sessions: WorkSession[]; commits: WorkCommit[] }) => setValue(previous => previous && JSON.stringify(previous) === JSON.stringify(next) ? previous : next);
    api.workSessions(projectId, work).then(next => { if (current) set({ work, ...next }); }, () => { if (current) set({ work, sessions: [], commits: [] }); });
    return () => { current = false; };
  }, [projectId, work, key, revision]);
  return value?.work === work ? value : null;
}

/** A work item's timeline, read again when its activity (`key`) or its folder changes; null until read. */
export function useWorkTimeline(work: string, key: string) {
  const { projectId, revision } = useWindow();
  const [value, setValue] = useState<{ work: string; timeline: WorkTimeline } | null>(null);
  useEffect(() => {
    let current = true;
    api.workTimeline(projectId, work).then(timeline => { if (current) setValue(previous => previous?.work === work && JSON.stringify(previous.timeline) === JSON.stringify(timeline) ? previous : { work, timeline }); }, () => { if (current) setValue(null); });
    return () => { current = false; };
  }, [projectId, work, key, revision]);
  return value?.work === work ? value.timeline : null;
}

/** A session's name: its own title, else its harness and when it started. */
export const sessionTitle = (session: Pick<WorkSession, 'title' | 'harness' | 'startedAt'>) => session.title?.trim() || harnessNames[session.harness] + ' session, ' + absoluteDate(session.startedAt);

/** How many sessions show before "Show all". */
const shown = 5;

/**
 * The plan's sessions, the latest first: the names of the chats that worked on it, with an indicator
 * while one is working. Their models, times and tokens are in the statistics below.
 */
export function SessionsList({ sessions }: { sessions: WorkSession[] }) {
  const [all, setAll] = useState(false);
  return <>
    <ul className="plan-aside-sessions">{(all ? sessions : sessions.slice(0, shown)).map(session => <li key={session.session} className="plan-aside-session" data-state={session.state}>
      <span className="plan-aside-session-title">{sessionTitle(session)}</span>
      {session.state === 'working' && <StatusIcon status={statuses.working} />}
    </li>)}</ul>
    {sessions.length > shown && <Button variant="text" className="plan-aside-more" onClick={() => setAll(!all)}>{all ? 'Show fewer' : 'Show all ' + sessions.length}</Button>}
  </>;
}

/**
 * A link in an agent's message, as the reader has links: a reference the message makes (in its text,
 * or as a link's address) once it leads somewhere; a web or mail address to the browser; anything
 * else stays text, so a relative address never moves the window.
 */
const messageComponents = {
  a: ({ href = '', children, ...props }: { href?: string; children?: ReactNode; 'data-reference'?: string }) => {
    if (props['data-reference']) return <ReferenceLink found={JSON.parse(props['data-reference']) as Found}>{children}</ReferenceLink>;
    if (/^(?:https?|mailto):/i.test(href)) return <MessageWebLink href={href}>{children}</MessageWebLink>;
    const found = wholeReference(href);
    return found ? <ReferenceLink found={found}>{children}</ReferenceLink> : <span className="outside-reference" title={href}>{children}</span>;
  },
  img: ({ alt = '' }: { alt?: string }) => <span className="outside-reference">{alt || 'Image'}</span>,
};
function MessageWebLink({ href, children }: { href: string; children?: ReactNode }) {
  const { notify } = useWindow();
  return <Link href={href} title={href} onClick={event => { event.preventDefault(); api.openExternal(href).catch(error => { if ((error as { code?: string }).code !== 'cancelled') notify((error as Error).message, 'warning'); }); }}>{children}</Link>;
}

/**
 * What a work item's state says it is for, as one line of Markdown under its title: what the user is
 * to do, what it waits on, why it is blocked. What it references links as in the reader, a PR with
 * its live state.
 */
export function StateNote({ note }: { note: string }) {
  const { collected, inputs } = useCollectedReferences();
  const plugins = useMemo((): Plugins => [[rehypeReferences, { collected, addresses: 'all' }]], [collected]);
  const resolved = useResolvedReferences(inputs);
  const scope = useMemo(() => ({ resolved }), [resolved]);
  return <span className="state-note"><ReferencesContext.Provider value={scope}><Markdown rehypePlugins={plugins} components={noteComponents}>{note}</Markdown></ReferencesContext.Provider></span>;
}
/** The note is one line: its paragraph stays inline. */
const noteComponents = { ...messageComponents, p: ({ children }: { children?: ReactNode }) => <>{children}</> };
