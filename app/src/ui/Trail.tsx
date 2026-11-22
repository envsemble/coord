import type { ReactNode } from 'react';
import { Breadcrumbs } from '@envsemble/envui';
import type { Target } from '../types';
import { hubPlace, workTarget } from '../navigation/targets';
import { wholeNumber } from './format';
import { useWindow } from '../window/windowContext';
import { ProjectAvatar } from '../projects/ProjectMenu';

/**
 * The breadcrumbs of a page of a project: Plans (every plan), the project with its avatar (its plans), then the
 * items given, the last the current page. `work`, the part the page is of, adds its work item before
 * it when it is a later part: Plans › Northwind › #0005 › #0005-2.
 */
export function Trail({ items, work }: { items: { label: ReactNode; target?: Target }[]; work?: string }) {
  const { open, go, projectId, projectName, snapshot } = useWindow();
  const group = work ? snapshot.work.find(item => item.id === work)?.partOf : null;
  return <Breadcrumbs className="breadcrumb" wrap={false} items={[
    { label: 'Plans', onClick: () => go(hubPlace()) },
    { label: <><ProjectAvatar project={{ id: projectId, name: projectName }} />{projectName}</>, onClick: () => go(hubPlace(projectId)) },
    ...group ? [{ label: wholeNumber(group), onClick: () => open(workTarget(group)) }] : [],
    ...items.map(item => ({ label: item.label, onClick: item.target ? () => open(item.target!) : undefined })),
  ]} />;
}
