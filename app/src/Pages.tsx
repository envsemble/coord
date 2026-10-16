// The frame of a page: its heading with its controls, its toolbar, and the repository filter.
import type { ReactNode } from 'react';
import { EmptyState, Select, Text } from '@envsemble/envui';
import { Code } from '@envsemble/envui/content';
import { ErrorIcon } from './icons';
import type { Snapshot } from './types';

export function Page({ title, heading, toolbar, children, className = '' }: { title?: ReactNode; heading?: ReactNode; toolbar?: ReactNode; children: ReactNode; className?: string }) {
  return <div className={'page ' + className}>
    {(title || heading) && <header className="page-header">
      {heading ?? <Text as="h1" variant="page-heading">{title}</Text>}
    </header>}
    {toolbar && <div className="page-toolbar">{toolbar}</div>}
    {children}
  </div>;
}

export interface RepositoryFilter { repository: string; setRepository(value: string): void }

/** Shown when the project plans for more than one repository. */
export function RepositorySelect({ snapshot, repository, setRepository }: RepositoryFilter & { snapshot: Snapshot }) {
  if (snapshot.repositories.length < 2) return null;
  const count = (id: string) => snapshot.work.filter(work => work.repositories.includes(id)).length;
  return <Select className="repository-select" density="compact" aria-label="Repository" value={repository} onValueChange={value => setRepository(value ?? 'all')}
    options={[{ value: 'all', label: 'All repositories' }, ...snapshot.repositories.map(item => ({ value: item.id, label: `${item.id} (${count(item.id)})` }))]} />;
}

export function Gone({ title, detail }: { title: string; detail: string }) {
  return <Page><EmptyState className="page-empty" icon={<ErrorIcon />} title={title} description={<Code>{detail}</Code>} /></Page>;
}
