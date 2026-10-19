// A plan's sessions and what they made, for its page: each agent session on it (harness, model and
// effort, its state, when it was last active, its agent time), resumed in a terminal from here; the
// links that matter (repositories and branches, PRs the plan references or its sessions opened,
// commits they made, the work folder); and, while the plan needs the person, the waiting session's
// message with a way to open that session. Read from the host as the plan's activity changes.
import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { Button } from '@envsemble/envui';
import { Markdown } from '@envsemble/envui/content';
import { AltRoute } from '@envsemble/envui/icons/AltRoute';
import { Terminal } from '@envsemble/envui/icons/Terminal';
import type { ReferenceInput, ResolvedReference, Work, WorkProduct, WorkSession, WorkTimeline } from '../types';
import { api } from '../api';
import { withEffort, aiModel } from '../ui/aiModels';
import { duration, relativeDate, absoluteDate } from '../ui/format';
import { CommitIcon, DotIcon, FolderOpenIcon } from '../ui/icons';
import { statuses } from '../ui/status';
import { RepositoryBadge, StatusIcon } from '../ui/ui';
import { useWorkbench } from '../workbench/workbenchContext';
import { PullMark, useResolvedReferences, type Resolutions } from '../workbench/ReferenceLink';
import { referenceKey } from '../workbench/references';
import { branches, excerpt, harnessNames, sessionStates } from './sessions';
import type { LiveActivity } from './agentTime';

/** What changes when the plan's activity does: the sessions' states and since when. */
export const activityKey = (activity: LiveActivity | null) => activity ? activity.state + ':' + activity.sessions.map(session => session.session + session.state + session.since + (session.countsFrom ?? '')).join(',') : '';

/** A work item's sessions and products, read again when its activity (`key`) or its folder changes; null until read. */
export function useWorkSessions(work: string, key: string) {
  const { project, revision } = useWorkbench();
  const [value, setValue] = useState<{ work: string; sessions: WorkSession[]; products: WorkProduct[] } | null>(null);
  useEffect(() => {
    let current = true;
    api.workSessions(project, work).then(next => { if (current) setValue({ work, ...next }); }, () => { if (current) setValue({ work, sessions: [], products: [] }); });
    return () => { current = false; };
  }, [project, work, key, revision]);
  return value?.work === work ? value : null;
}

/** A work item's timeline, read again when its activity (`key`) or its folder changes; null until read. */
export function useWorkTimeline(work: string, key: string) {
  const { project, revision } = useWorkbench();
  const [value, setValue] = useState<{ work: string; timeline: WorkTimeline } | null>(null);
  useEffect(() => {
    let current = true;
    api.workTimeline(project, work).then(timeline => { if (current) setValue({ work, timeline }); }, () => { if (current) setValue(null); });
    return () => { current = false; };
  }, [project, work, key, revision]);
  return value?.work === work ? value.timeline : null;
}

/** Resume a session in a terminal on this computer; a failure says why. */
function useResume(work: string) {
  const { project, notify, remote } = useWorkbench();
  return (session: WorkSession) => remote || !session.resume || !session.folder ? null
    : () => { api.resumeSession(project, work, session.session).catch(error => { if ((error as { code?: string }).code !== 'cancelled') notify((error as Error).message, 'warning'); }); };
}

/** A session's harness, model and effort: "Claude Code · Claude Opus 5.5 · high". */
export const sessionLabel = (session: Pick<WorkSession, 'harness' | 'model' | 'effort'>) => [harnessNames[session.harness], session.model && withEffort(aiModel(session.model).name, session.effort)].filter(Boolean).join(' · ');

/** How many of a list show before "Show all". */
const shown = 5;
function More({ count, open, toggle }: { count: number; open: boolean; toggle(): void }) {
  return count > shown ? <Button variant="text" className="about-more" onClick={toggle}>{open ? 'Show fewer' : 'Show all ' + count}</Button> : null;
}

/** The plan's sessions, the latest first: each with its state, when it was last active and its agent time, and a way to resume it. */
export function SessionsList({ work, sessions }: { work: string; sessions: WorkSession[] }) {
  const resume = useResume(work);
  const [all, setAll] = useState(false);
  return <>
    <ul className="about-sessions">{(all ? sessions : sessions.slice(0, shown)).map(session => {
      const run = resume(session);
      return <li key={session.session} className="about-session" data-state={session.state}>
        {session.state === 'ended' ? <DotIcon className="session-ended-icon" label="Ended" /> : <StatusIcon status={statuses[session.state]} />}
        <div className="about-session-text">
          <span className="about-session-title" title={session.session}>{sessionLabel(session)}</span>
          <span className="muted">{sessionStates[session.state]} · <span title={absoluteDate(session.lastSeen)}>{relativeDate(session.lastSeen)}</span>{session.agentMs > 0 && ' · ' + duration(session.agentMs)}</span>
        </div>
        {run && <Button variant="text" startIcon={<Terminal />} title={session.resume + ' in ' + session.folder} onClick={run}>Resume</Button>}
      </li>;
    })}</ul>
    <More count={sessions.length} open={all} toggle={() => setAll(!all)} />
  </>;
}

/** A PR as the Links section shows it: its name, its title and its state. */
export interface PullLink { label: string; url: string; title: string | null; pull: ResolvedReference['pull'] }

/** PRs a plan references, with what the host answered for them, as the reader found them. */
export function referencedPulls(inputs: ReferenceInput[], resolved: Resolutions): PullLink[] {
  return inputs.filter(input => input.kind === 'pull').flatMap(input => {
    const answer = resolved.get(referenceKey(input));
    return answer?.url ? [{ label: (answer.repository ?? input.repository ?? '') + '#' + input.value, url: answer.url, title: answer.pull?.title ?? null, pull: answer.pull }] : [];
  });
}

function Row({ icon, children }: { icon: ReactNode; children: ReactNode }) {
  return <li className="about-link">{icon}<span className="about-link-text">{children}</span></li>;
}

/**
 * The plan's links: its repositories and the branches its sessions worked on, the PRs it references
 * or its sessions opened (with their state), the commits they made, and its work folder in the editor.
 */
export function LinksList({ work, repositories, products, pulls }: { work: Work; repositories: string[]; products: WorkProduct[]; pulls: PullLink[] }) {
  const { project, notify, remote } = useWorkbench();
  const [all, setAll] = useState(false);
  const failed = (error: Error) => { if ((error as { code?: string }).code !== 'cancelled') notify(error.message, 'warning'); };
  const open = (url: string) => { api.openExternal(url).catch(failed); };
  // The PRs the sessions opened, with their state from the host, after those the plan references.
  const opened = useMemo(() => products.filter(product => product.kind === 'pull' && product.repository).map(product => ({ kind: 'pull' as const, repository: product.repository, value: product.id, line: null })), [products]);
  const resolved = useResolvedReferences(work.id, opened);
  const sessionPulls: PullLink[] = products.filter(product => product.kind === 'pull').flatMap(product => {
    const answer = product.repository ? resolved.get(referenceKey({ kind: 'pull', repository: product.repository, value: product.id, line: null })) : null;
    const url = answer?.url ?? product.url;
    return url ? [{ label: (product.repository ?? '') + '#' + product.id, url, title: answer?.pull?.title ?? product.title, pull: answer?.pull ?? null }] : [];
  });
  const prs = [...pulls, ...sessionPulls].filter((pull, index, list) => list.findIndex(other => other.url === pull.url) === index);
  const worked = branches(products);
  const plain = repositories.filter(id => !worked.some(entry => entry.repository === id));
  const commits = products.filter(product => product.kind === 'commit');
  const shortHash = (id: string) => id.slice(0, 7);
  return <>
    <ul className="about-links">
      {worked.map(entry => <Row key={entry.repository + entry.branch} icon={<AltRoute className="about-link-icon" />}><RepositoryBadge id={entry.repository} />{entry.branch && <code className="about-branch">{entry.branch}</code>}</Row>)}
      {plain.length > 0 && <Row icon={<AltRoute className="about-link-icon" />}>{plain.map(id => <RepositoryBadge key={id} id={id} />)}</Row>}
      {prs.map(pull => <Row key={pull.url} icon={pull.pull ? <PullMark pull={pull.pull} /> : <AltRoute className="about-link-icon" />}>
        <a href="#" title={pull.url} onClick={event => { event.preventDefault(); open(pull.url); }}>{pull.label}</a>{pull.title && <span className="muted"> {pull.title}</span>}
      </Row>)}
      {(all ? commits : commits.slice(0, shown)).map(commit => <Row key={commit.repository + commit.id} icon={<CommitIcon className="about-link-icon" />}>
        {commit.url ? <a href="#" title={commit.url} onClick={event => { event.preventDefault(); open(commit.url!); }}>{(commit.repository ? commit.repository + '@' : '') + shortHash(commit.id)}</a> : <code>{shortHash(commit.id)}</code>}
        {commit.title && <span className="muted"> {commit.title}</span>}
      </Row>)}
      {!remote && <Row icon={<FolderOpenIcon className="about-link-icon" />}><a href="#" onClick={event => { event.preventDefault(); api.openWorkFolder(project, work.id).catch(failed); }}>Open the work folder</a></Row>}
    </ul>
    <More count={commits.length} open={all} toggle={() => setAll(!all)} />
  </>;
}

/**
 * Why the plan needs the person: the waiting session's last message, rendered as the Markdown it is,
 * its beginning first, with a way to open that session.
 */
export function NeedsYou({ work, session }: { work: string; session: WorkSession }) {
  const resume = useResume(work)(session);
  const [whole, setWhole] = useState(false);
  const message = session.message ?? '';
  const start = excerpt(message);
  return <section className="needs-you" aria-label="Why it needs you">
    <div className="needs-you-message" data-clamped={!whole && start.more ? '' : undefined}><Markdown>{whole ? message.trim() : start.text}</Markdown></div>
    <div className="needs-you-actions">
      {start.more && <Button variant="text" onClick={() => setWhole(!whole)} aria-expanded={whole}>{whole ? 'Show less' : 'Show all'}</Button>}
      <span className="muted">{sessionLabel(session)} · waiting since <span title={absoluteDate(session.lastSeen)}>{relativeDate(session.lastSeen)}</span></span>
      <span className="spacer" />
      {resume && <Button variant="secondary" startIcon={<Terminal />} onClick={resume}>Open session</Button>}
    </div>
  </section>;
}
