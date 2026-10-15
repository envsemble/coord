import { EmptyState, GroupedRows, Row } from '@envsemble/envui';
import { Code } from '@envsemble/envui/content';
import { CommitIcon, FileIcon } from './icons';
import type { Snapshot } from './types';
import { samePath } from './links';
import { documentTarget, workTarget } from './targets';
import { absoluteDate, relativeDate, workNumber } from './format';
import { TargetLink, useWorkbench } from './workbenchContext';
import { Page } from './Pages';

/** The project's Git history: each commit, the work it touched and the files it changed. */
export function Activity({ snapshot, repository }: { snapshot: Snapshot; repository: string }) {
  const { open } = useWorkbench();
  const same = (a: string, b: string) => samePath(a, b, snapshot.caseSensitivePaths, snapshot.normalizationInsensitivePaths);
  const find = (path: string) => snapshot.documents.find(document => same(document.path, path));
  const owner = (id: string | null) => snapshot.work.find(work => work.id === id);
  const entries = snapshot.history.filter(entry => repository === 'all' || entry.repositories.includes(repository) || entry.files.some(file => { const document = find(file); return document?.workId === null && document.repositories.includes(repository); }));
  const titles = new Map(snapshot.work.map(work => [work.id, work.title]));
  return <Page section title="Activity">
    {!snapshot.gitAvailable ? <EmptyState className="page-empty" icon={<CommitIcon />} title="No Git history" description="This planning folder is not its own Git repository." />
      : entries.length ? <GroupedRows className="activity-list" aria-label="Commits">{entries.map(entry => <Row className="activity-row" key={entry.id}
        title={<span className="activity-title"><strong>{entry.title}</strong>{entry.workIds.map(id => <TargetLink key={id} className="activity-work" target={workTarget(id)} title={titles.get(id)}>{workNumber(id)}</TargetLink>)}</span>}
        detail={<span className="changed-files">{entry.files.slice(0, 5).map(file => { const document = find(file); return <button type="button" key={file} className="file-chip" disabled={!document} title={file} onClick={event => document && open(documentTarget(document, owner(document.workId)), { pin: event.ctrlKey || event.metaKey })}><FileIcon />{file.split('/').at(-1)}</button>; })}{entry.files.length > 5 && <span className="muted">+{entry.files.length - 5} more</span>}</span>}
        action={<span className="activity-meta"><Code appearance="subtle">{entry.id.slice(0, 7)}</Code><span title={absoluteDate(entry.date)}>{relativeDate(entry.date)}</span></span>} />)}
      </GroupedRows> : <EmptyState className="page-empty" icon={<CommitIcon />} title="No recent activity" />}
  </Page>;
}
