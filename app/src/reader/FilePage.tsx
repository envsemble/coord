import { Button } from '@envsemble/envui';
import { FolderOpenIcon } from '../ui/icons';
import { api } from '../api';
import type { Document, Snapshot } from '../types';
import { workTarget } from '../navigation/targets';
import { workNumber } from '../ui/format';
import { Trail } from '../ui/Trail';
import { Reader, useReferences } from './Reader';
import { useWindow } from '../window/windowContext';

/**
 * A file on the page as a plan is: the breadcrumb (its project, its plan's number when it is one of a
 * plan's, its name, with its path on hover) with Show in folder quietly on its right, then the file as
 * the reader shows it.
 */
export function FilePage({ file, snapshot, anchor }: { file: Document; snapshot: Snapshot; anchor: string | null }) {
  const { projectId, notify, remote } = useWindow();
  const owner = snapshot.work.find(work => work.id === file.workId) ?? snapshot.work.find(work => file.path.startsWith(work.path + '/'));
  const references = useReferences(file, file.workId, file.format === 'markdown');
  const reveal = () => { api.reveal(projectId, file.path).catch(error => notify((error as Error).message, 'warning')); };
  return <div className="page file-page">
    <div className="work-trail">
      <Trail items={[...(owner ? [{ label: workNumber(owner.id), target: workTarget(owner.id) }] : []), { label: <span title={file.path}>{file.name}</span> }]} />
      {!remote && <Button variant="text" className="work-export" startIcon={<FolderOpenIcon />} onClick={reveal} title="Show this file in your file manager">Show in folder</Button>}
    </div>
    <Reader key={file.path} file={file} snapshot={snapshot} anchor={anchor} references={references} showWork={!file.workId} />
  </div>;
}
