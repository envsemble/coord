import type { ReactNode } from 'react';
import { Breadcrumbs } from '@envsemble/envui';
import type { Target } from '../types';
import { hubPlace, workTarget } from '../navigation/targets';
import { workNumber } from './format';
import { useWindow } from '../window/windowContext';

/**
 * The breadcrumbs of a page of a project: Plans (every plan), the project (its plans), then the
 * items given, the last the current page. `work`, the work item the page is of, adds the group it is
 * a part of before it: Plans › Northwind › #0005 › #0006.
 */
export function Trail({ items, work }: { items: { label: ReactNode; target?: Target }[]; work?: string }) {
  const { open, go, projectId, projectName, snapshot } = useWindow();
  const group = work ? snapshot.work.find(item => item.id === work)?.partOf : null;
  return <Breadcrumbs className="breadcrumb" items={[
    { label: 'Plans', onClick: () => go(hubPlace()) },
    { label: projectName, onClick: () => go(hubPlace(projectId)) },
    ...group ? [{ label: workNumber(group), onClick: () => open(workTarget(group)) }] : [],
    ...items.map(item => ({ label: item.label, onClick: item.target ? () => open(item.target!) : undefined })),
  ]} />;
}
