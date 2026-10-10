import { useState } from 'react';
import type { ImportPreview } from '../shared/contract';
import { WorkflowIcon } from './icons';
import { absoluteDate, bytes, workNumber } from './format';
import { Dialog } from './components/Dialog';
import { Spinner } from './ui';

/** The preview shown before an import writes anything. */
export function ImportDialog({ preview, onConfirm, onCancel }: { preview: ImportPreview; onConfirm(): Promise<void>; onCancel(): void }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const confirm = async () => {
    setBusy(true); setError('');
    try { await onConfirm(); } catch (failure) { setError((failure as Error).message); setBusy(false); }
  };
  const rows: [string, string | null][] = [
    ['File', preview.file],
    ['Original work', [preview.originalId && workNumber(preview.originalId), preview.origin && 'from ' + preview.origin].filter(Boolean).join(' ') || null],
    ['Exported', [absoluteDate(preview.exportedAt), preview.atlasVersion && 'Atlas ' + preview.atlasVersion].filter(Boolean).join(' · ') || null],
    ['Imports as', [preview.newId && workNumber(preview.newId), preview.newFolder].filter(Boolean).join(' in ') || null],
    ['Contents', `${preview.files} ${preview.files === 1 ? 'file' : 'files'}, ${bytes(preview.bytes)}`],
  ];
  return <Dialog label="Import plan" onClose={busy ? () => undefined : onCancel} className="import-dialog">
    <h2 className="dialog-title">Import “{preview.title}”</h2>
    <p className="muted">The plan is added as new work in this planning folder. Nothing is committed; review and commit the files yourself.</p>
    <dl className="import-facts">{rows.filter(([, value]) => value).map(([label, value]) => <div key={label}><dt>{label}</dt><dd>{value}</dd></div>)}</dl>
    {preview.diagrams.length > 0 && <><h3 className="dialog-subtitle">Diagrams</h3><ul className="import-diagrams">{preview.diagrams.map((title, index) => <li key={index}><WorkflowIcon size={16} />{title}</li>)}</ul></>}
    {preview.warnings.map((warning, index) => <div key={index} className="flash flash-warning">{warning}</div>)}
    {error && <div className="flash flash-danger" role="alert">{error}</div>}
    <div className="dialog-actions">
      <button type="button" className="btn" onClick={onCancel} disabled={busy}>Cancel</button>
      <button type="button" className="btn btn-primary" onClick={() => void confirm()} disabled={busy}>{busy ? <Spinner /> : 'Import'}</button>
    </div>
  </Dialog>;
}
