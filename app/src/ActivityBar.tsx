import type { ReactNode } from 'react';
import { AtlasMark } from '@envsemble/atlas-diagrams/react';
import { AlertIcon, FileDirectoryIcon, GraphIcon, IssueOpenedIcon, PulseIcon } from './icons';
import type { Issue, ViewName } from './types';
import { workNumber } from './format';
import { workTarget } from './targets';
import { Popover } from './components/Popover';
import { useWorkbench } from './workbenchContext';

const views: { id: ViewName; label: string; icon: ReactNode }[] = [
  { id: 'work', label: 'Work', icon: <IssueOpenedIcon size={24} /> },
  { id: 'activity', label: 'Activity', icon: <PulseIcon size={24} /> },
  { id: 'statistics', label: 'Statistics', icon: <GraphIcon size={24} /> },
];

export function ActivityBar({ explorer, activeView, activeCount, onExplorer, onView, issues }: {
  explorer: boolean; activeView: ViewName | null; activeCount: number; onExplorer(): void; onView(view: ViewName): void; issues: Issue[];
}) {
  return <nav className="activity-bar" aria-label="Views">
    <div className="activity-brand" aria-hidden="true"><AtlasMark size={24} label="" /></div>
    <button type="button" className={'activity-item' + (explorer ? ' active' : '')} aria-pressed={explorer} aria-label="Explorer" title="Explorer (Ctrl+B)" onClick={onExplorer}><FileDirectoryIcon size={24} /></button>
    {views.map(view => <button key={view.id} type="button" className={'activity-item' + (activeView === view.id ? ' active' : '')} aria-label={view.label} title={view.label} aria-current={activeView === view.id ? 'page' : undefined} onClick={() => onView(view.id)}>
      {view.icon}{view.id === 'work' && activeCount > 0 && <span className="activity-badge">{activeCount}</span>}
    </button>)}
    <span className="spacer" />
    <Health issues={issues} />
  </nav>;
}

function Health({ issues }: { issues: Issue[] }) {
  const { open } = useWorkbench();
  if (!issues.length) return null;
  const errors = issues.some(issue => issue.level === 'error');
  const label = issues.length + ' record health ' + (issues.length === 1 ? 'note' : 'notes');
  return <Popover label="Record health" className="health" placement="right" align="end" buttonClassName={'activity-item health-button' + (errors ? ' has-errors' : '')} title={label} button={<><AlertIcon size={24} /><span className="activity-badge">{issues.length}</span></>}>
    {close => <div className="action-menu health-menu">
      <div className="menu-title">Record health</div>
      <ul>{issues.map((issue, index) => <li key={index} className={issue.level}>
        <AlertIcon size={16} />
        <span>{issue.workId && <><button type="button" className="link-button" onClick={() => { close(); open(workTarget(issue.workId!), { pin: true }); }}>{workNumber(issue.workId)}</button>{' '}</>}{issue.message}</span>
      </li>)}</ul>
    </div>}
  </Popover>;
}
