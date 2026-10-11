import type { ReactNode } from 'react';
import { GitCommitIcon } from './icons';
import type { Snapshot } from './types';
import { samePath } from './links';
import { documentTarget, workTarget } from './targets';
import { absoluteDate, relativeDate, workNumber } from './format';
import { Blankslate } from './ui';
import { TargetLink, useWorkbench } from './workbenchContext';

export function Activity({ snapshot, repository, repositoryMenu }: { snapshot: Snapshot; repository: string; repositoryMenu: ReactNode }) {
  const { open } = useWorkbench();
  const same = (a: string, b: string) => samePath(a, b, snapshot.caseSensitivePaths, snapshot.normalizationInsensitivePaths);
  const find = (path: string) => snapshot.documents.find(document => same(document.path, path));
  const owner = (id: string | null) => snapshot.work.find(work => work.id === id);
  const entries = snapshot.history.filter(entry => repository === 'all' || entry.repositories.includes(repository) || entry.files.some(file => { const document = find(file); return document?.workId === null && document.repositories.includes(repository); }));
  const titles = new Map(snapshot.work.map(work => [work.id, work.title]));
  return <div className="page">
    <div className="page-heading-row"><h1 className="page-heading">Activity</h1><span className="spacer" />{repositoryMenu}</div>
    {!snapshot.gitAvailable ? <div className="box"><Blankslate icon={<GitCommitIcon size={24} />} title="No Git history">This planning folder is not its own Git repository.</Blankslate></div>
      : entries.length ? <ul className="box activity-list">{entries.map(entry => <li className="activity-row" key={entry.id}>
        <GitCommitIcon size={16} className="activity-icon" />
        <div className="activity-main">
          <div className="activity-title"><strong>{entry.title}</strong>{entry.workIds.map(id => <TargetLink key={id} className="label label-muted label-link" target={workTarget(id)} title={titles.get(id)}>{workNumber(id)}</TargetLink>)}</div>
          <div className="changed-files">{entry.files.slice(0, 5).map(file => { const document = find(file); return <button type="button" key={file} className="file-chip" disabled={!document} title={file} onClick={event => document && open(documentTarget(document, owner(document.workId)), { pin: event.ctrlKey || event.metaKey })}>{file.split('/').at(-1)}</button>; })}{entry.files.length > 5 && <span className="muted">+{entry.files.length - 5} more</span>}</div>
        </div>
        <div className="activity-meta"><code>{entry.id.slice(0, 7)}</code><span title={absoluteDate(entry.date)}>{relativeDate(entry.date)}</span></div>
      </li>)}</ul> : <div className="box"><Blankslate icon={<GitCommitIcon size={24} />} title="No recent activity" /></div>}
  </div>;
}
