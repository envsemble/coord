import type { ReactNode } from 'react';
import { Breadcrumbs } from '@envsemble/envui';
import type { Target } from '../types';
import { hubPlace } from '../navigation/targets';
import { useWindow } from '../window/windowContext';

/** A trail of targets, after the project (which leads to its plans in the hub); the last item is the current page. */
export function Trail({ items }: { items: { label: ReactNode; target?: Target }[] }) {
  const { open, go, projectId, projectName } = useWindow();
  return <Breadcrumbs className="breadcrumb" items={[{ label: projectName, onClick: () => go(hubPlace(projectId)) }, ...items.map(item => ({ label: item.label, onClick: item.target ? () => open(item.target!) : undefined }))]} />;
}
