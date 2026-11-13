import { Button } from '@envsemble/envui';
import { FolderOpenIcon } from '../ui/icons';
import { api } from '../api';
import type { Document, Snapshot } from '../types';
import { workTarget } from '../navigation/targets';
import { workNumber } from '../ui/format';
import { Trail } from '../ui/Trail';
import { Page } from '../ui/Page';
import { Reader, useReferences } from './Reader';
import { useWindow } from '../window/windowContext';

/**
 * A file on the page as a plan is: the plan's breadcrumb (its project, and its plan's number when it is
 * one of a plan's), the file's title with its name below it (its path on hover), and Show in folder
 * quietly on its right, then the file as the reader shows it.
 */
export function FilePage({ file, snapshot, anchor }: { file: Document; snapshot: Snapshot; anchor: string | null }) {
  const { projectId, notify, remote } = useWindow();
  const owner = snapshot.work.find(work => work.id === file.workId) ?? snapshot.work.find(work => file.path.startsWith(work.path + '/'));
  const references = useReferences(file, file.workId, file.format === 'markdown');
  const reveal = () => { api.reveal(projectId, file.path).catch(error => notify((error as Error).message, 'warning')); };
  const name = <span className="file-name" title={file.path}>{file.name}</span>;
  return <Page className="file-page" width="md" title={file.title === file.name ? name : file.title} meta={file.title === file.name ? undefined : name}
    breadcrumbs={<Trail work={owner?.id} items={owner ? [{ label: workNumber(owner.id), target: workTarget(owner.id) }] : []} />}
    actions={!remote && <Button variant="secondary" size="sm" startIcon={<FolderOpenIcon />} onClick={reveal} title="Show this file in your file manager">Show in folder</Button>}>
    <Reader key={file.path} file={file} snapshot={snapshot} anchor={anchor} references={references} hideTitle={file.title} />
  </Page>;
}
