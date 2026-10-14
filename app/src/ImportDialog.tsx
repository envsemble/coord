import { useState } from 'react';
import { Button, Dialog, Notice, Text } from '@envsemble/envui';
import type { ImportPreview } from '../shared/contract';
import { DiagramIcon } from './icons';
import { absoluteDate, bytes, workNumber } from './format';

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
  return <Dialog open onOpenChange={open => { if (!open && !busy) onCancel(); }} pending={busy} className="import-dialog"
    title={`Import “${preview.title}”`}
    description="The plan is added as new work in this planning folder. Nothing is committed; review and commit the files yourself."
    closeLabel="Cancel" actions={<Button variant="primary" onClick={() => void confirm()} pending={busy}>Import</Button>}>
    <dl className="facts import-facts">{rows.filter(([, value]) => value).map(([label, value]) => <div key={label}><dt>{label}</dt><dd>{value}</dd></div>)}</dl>
    {preview.diagrams.length > 0 && <><Text as="h3" variant="section-heading" className="dialog-subtitle">Diagrams</Text><ul className="import-diagrams">{preview.diagrams.map((title, index) => <li key={index}><DiagramIcon />{title}</li>)}</ul></>}
    {preview.warnings.map((warning, index) => <Notice key={index} tone="warning">{warning}</Notice>)}
    {error && <Notice tone="error" announce>{error}</Notice>}
  </Dialog>;
}
