// Connect to another computer: pair with another computer's Atlas from its pairing link (or its
// address and code). That computer is then one of the computers this app works on: its folder list
// opens here, and any of its planning folders can be opened through its folder browser.
import { useState } from 'react';
import { Button, Dialog, EmptyState, Input, Notice, Spinner, Text } from '@envsemble/envui';
import { FolderIcon } from './icons';
import type { Computer, ComputerRef } from './types';
import { api } from './api';
import { FolderRows, useComputerFolders } from './Computers';

export function ConnectDialog({ onClose, onBrowse }: { onClose(): void; onBrowse(computer: ComputerRef & { hostId: string }): void }) {
  const [link, setLink] = useState('');
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [paired, setPaired] = useState<Computer | null>(null);
  // A pasted link carries its code; an address alone needs the code typed.
  const needsCode = link.trim() !== '' && !/#token=/.test(link);
  const connect = async () => {
    setBusy(true); setError('');
    try { setPaired(await api.pairRemote(link.trim(), needsCode ? code.trim() || null : null)); }
    catch (failure) { setError((failure as Error).message); }
    finally { setBusy(false); }
  };
  const close = (open: boolean) => { if (!open && !busy) onClose(); };
  if (paired) return <Paired computer={paired} onClose={onClose} onBrowse={onBrowse} />;
  return <Dialog open onOpenChange={close} pending={busy} className="connect-dialog" title="Connect to another Atlas"
    description={<>On the other computer, choose <strong>Remote Access…</strong>, turn remote access on and create a pairing link. Paste the link here, or type its address and code. The link works once, for five minutes.</>}
    actions={<>
      <Button variant="secondary" onClick={onClose} disabled={busy}>Cancel</Button>
      <Button variant="primary" type="submit" form="connect-form" pending={busy} disabled={!link.trim() || (needsCode && !code.trim())}>Connect</Button>
    </>}>
    <form id="connect-form" className="dialog-form" onSubmit={event => { event.preventDefault(); void connect(); }}>
      <Input label="Pairing link or address" value={link} onChange={event => setLink(event.target.value)} placeholder="http://100.64.1.2:7346/pair#token=…" autoFocus spellCheck={false} autoComplete="off" disabled={busy}
        hint="Use the Tailscale address to connect from anywhere on your tailnet. On a local network, the connection is not encrypted." />
      {needsCode && <Input label="Pairing code" value={code} onChange={event => setCode(event.target.value)} placeholder="XXXX-XXXX-XXXX-XXXX" spellCheck={false} autoComplete="off" disabled={busy} />}
      {error && <Notice tone="error" role="alert">{error}</Notice>}
    </form>
  </Dialog>;
}

/** Paired: open one of that computer's planning folders, or browse it for another. */
function Paired({ computer, onClose, onBrowse }: { computer: Computer; onClose(): void; onBrowse(computer: ComputerRef & { hostId: string }): void }) {
  const { folders, error: listError } = useComputerFolders(computer.hostId);
  const [error, setError] = useState('');
  const target = { hostId: computer.hostId!, name: computer.name };
  return <Dialog open onOpenChange={open => { if (!open) onClose(); }} size="wide" className="connect-dialog" title="Connect to another Atlas"
    actions={<>
      <Button variant="secondary" onClick={onClose}>Close</Button>
      <Button variant="primary" startIcon={<FolderIcon />} onClick={() => onBrowse(target)}>Open Folder on {computer.name}…</Button>
    </>}>
    <Text>This computer is paired with <strong>{computer.name}</strong>. Choose <strong>{computer.name}</strong> in the computer menu at the top of the window to work on it{computer.manageAccess ? '; you can also pair and revoke its devices' : ''}.</Text>
    {folders === null ? <Spinner label="Loading its planning folders" />
      : folders.length ? <FolderRows computer={computer} folders={folders} onError={setError} onOpened={onClose} />
      : <EmptyState title="No planning folders yet" description={listError || 'No planning folders were opened on ' + computer.name + ' yet.'} />}
    {error && <Notice tone="error" role="alert">{error}</Notice>}
  </Dialog>;
}
