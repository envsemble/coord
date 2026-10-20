// A plan's sessions, for its page: each agent session on it by its own title, with its harness,
// model and effort, its state, when it was last active and its agent time; and, while the plan needs
// the person, the waiting session's message. Read from the host as the plan's activity changes.
import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { Button } from '@envsemble/envui';
import { Markdown } from '@envsemble/envui/content';
import type { WorkCommit, WorkSession, WorkTimeline } from '../types';
import { api } from '../api';
import { ModelName } from '../ui/ModelName';
import { absoluteDate, relativeDate } from '../ui/format';
import { statuses } from './status';
import { StatusIcon } from '../ui/badges';
import { ErrorIcon } from '../ui/icons';
import { useWindow } from '../window/windowContext';
import { ReferenceLink, ReferencesContext, useCollectedReferences, useResolvedReferences } from '../reader/ReferenceLink';
import { rehypeReferences, wholeReference, type Found } from '../reader/references';
import type { Plugins } from '../reader/Reader';
import { excerpt, harnessNames } from './sessions';
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

/** A session's harness, then its model with its provider's mark and effort: "Claude Code · Claude Opus 5.5 · high". */
function SessionLabel({ session }: { session: Pick<WorkSession, 'harness' | 'model' | 'effort'> }) {
  return <>{harnessNames[session.harness]}{session.model && <> · <ModelName model={session.model} effort={session.effort} /></>}</>;
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
  return <a href="#" title={href} onClick={event => { event.preventDefault(); api.openExternal(href).catch(error => { if ((error as { code?: string }).code !== 'cancelled') notify((error as Error).message, 'warning'); }); }}>{children}</a>;
}

/**
 * Why the plan needs the person: the waiting session's last message, rendered as the Markdown it is,
 * its beginning first. What it references links as in the reader.
 */
/** A session's latest message, as Markdown with its references linked: its beginning, with Show all for the rest. */
function SessionMessage({ message, className }: { message: string; className: string }) {
  const [whole, setWhole] = useState(false);
  const start = excerpt(message);
  const { collected, inputs } = useCollectedReferences();
  const plugins = useMemo((): Plugins => [[rehypeReferences, { collected, addresses: 'all' }]], [collected]);
  const resolved = useResolvedReferences(inputs);
  const scope = useMemo(() => ({ resolved }), [resolved]);
  return <>
    <div className={className} data-clamped={!whole && start.more ? '' : undefined}><ReferencesContext.Provider value={scope}><Markdown rehypePlugins={plugins} components={messageComponents}>{whole ? message.trim() : start.text}</Markdown></ReferencesContext.Provider></div>
    {start.more && <Button variant="text" className="now-more" onClick={() => setWhole(!whole)} aria-expanded={whole}>{whole ? 'Show less' : 'Show all'}</Button>}
  </>;
}

/**
 * Now, while the plan is implemented: what each session on it is doing, by its latest message and
 * its last few actions, newest first (a session that waits for the person says why in Needs you,
 * so only its actions show here); with none on it, where the work stopped. Nothing is kept: it is
 * read from the sessions' logs as they change.
 */
/** Whether a session's Now says anything: a message or an action. */
const saysSomething = (session: WorkSession) => Boolean(session.now && (session.now.message || session.now.actions.length));
/** What Now shows: the sessions on the plan that say something, else the latest that does (where the work stopped); none when nothing does. */
export function nowSessions(sessions: WorkSession[]): WorkSession[] {
  const on = sessions.filter(session => session.state !== 'ended' && saysSomething(session));
  return on.length ? on : sessions.filter(saysSomething).slice(0, 1);
}

export function NowSection({ sessions }: { sessions: WorkSession[] }) {
  const on = sessions.filter(session => session.state !== 'ended' && saysSomething(session));
  const shownSessions = nowSessions(sessions);
  if (!shownSessions.length) return null;
  return <section className="now" aria-label="Now">
    {!on.length && <p className="now-stopped muted">Nobody is on it now. Where the work stopped:</p>}
    {shownSessions.map(session => <div key={session.session} className="now-session">
      <div className="now-head">
        {session.state === 'working' && <StatusIcon status={statuses.working} decorative />}
        <span className="now-title">{sessionTitle(session)}</span>
        <span className="muted"> · {session.state === 'working' ? 'working' : session.state === 'waiting' ? 'needs you' : session.state === 'idle' ? 'idle, waiting on something else' : 'ended'} · <span title={absoluteDate(session.lastSeen)}>{relativeDate(session.lastSeen)}</span></span>
      </div>
      {session.now!.message && session.state !== 'waiting' && <SessionMessage message={session.now!.message} className="now-message" />}
      {session.now!.actions.length > 0 && <ul className="now-actions" aria-label="Its last actions, newest first">
        {session.now!.actions.map((action, index) => <li key={index} data-kind={action.kind} data-failed={action.failed ? '' : undefined}>
          {action.failed && <ErrorIcon className="now-failed" label="Failed" />}{action.text}
        </li>)}
      </ul>}
    </div>)}
  </section>;
}

export function NeedsYou({ work, session }: { work: string; session: WorkSession }) {
  const [whole, setWhole] = useState(false);
  const message = session.message ?? '';
  const start = excerpt(message);
  // What the message references, as it renders: also a link's address naming a reference.
  const { collected, inputs } = useCollectedReferences();
  const plugins = useMemo((): Plugins => [[rehypeReferences, { collected, addresses: 'all' }]], [collected]);
  const resolved = useResolvedReferences(inputs);
  const scope = useMemo(() => ({ resolved }), [resolved]);
  return <section className="needs-you" aria-label="Why it needs you">
    <div className="needs-you-message" data-clamped={!whole && start.more ? '' : undefined}><ReferencesContext.Provider value={scope}><Markdown rehypePlugins={plugins} components={messageComponents}>{whole ? message.trim() : start.text}</Markdown></ReferencesContext.Provider></div>
    <div className="needs-you-actions">
      {start.more && <Button variant="text" onClick={() => setWhole(!whole)} aria-expanded={whole}>{whole ? 'Show less' : 'Show all'}</Button>}
      <span className="muted"><SessionLabel session={session} /> · waiting since <span title={absoluteDate(session.lastSeen)}>{relativeDate(session.lastSeen)}</span></span>
    </div>
  </section>;
}
