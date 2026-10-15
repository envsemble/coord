// A project's page, opened as a tab from the sidebar: its work list with its filters, then its
// statistics and its activity, as sections of one page. One repository filter applies to them all.
import { useState } from 'react';
import { Badge, Text } from '@envsemble/envui';
import type { Project, Snapshot } from './types';
import { WorkList } from './WorkList';
import { Statistics } from './StatisticsPage';
import { Activity } from './Views';
import { RepositorySelect } from './Pages';

export interface WorkFilters { location: string; setLocation(value: string): void; search: string; setSearch(value: string): void }

export function ProjectPage({ project, snapshot, work }: { project: Project | undefined; snapshot: Snapshot; work: WorkFilters }) {
  const [repository, setRepository] = useState('all');
  return <div className="page project-page">
    <header className="page-header project-header">
      <div className="page-heading-row">
        <Text as="h1" variant="page-heading">{project?.name ?? snapshot.name}</Text>
        {project && project.state !== 'active' && <Badge tone="warning">{project.state === 'archived' ? 'Archived' : 'Hidden'}</Badge>}
        <span className="spacer" />
        <RepositorySelect snapshot={snapshot} repository={repository} setRepository={setRepository} />
      </div>
      <Text variant="caption" tone="muted" className="project-path"><bdi>{snapshot.root}</bdi></Text>
    </header>
    <WorkList snapshot={snapshot} repository={repository} {...work} />
    <Statistics snapshot={snapshot} repository={repository} />
    <Activity snapshot={snapshot} repository={repository} />
  </div>;
}
