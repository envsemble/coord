// File › Connect to Another Atlas…: pair with another computer's Atlas from its pairing link (or
// its address and code). That computer is then one of the computers this app works on: its folder
// list opens here, and any of its planning folders can be opened through its folder browser.
import { useState } from 'react';
import { FileDirectoryIcon } from './icons';
import type { Computer, ComputerRef } from './types';
import { api } from './api';
import { FolderList, useComputerFolders } from './Computers';
import { Dialog } from './components/Dialog';
import { Spinner } from './ui';

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
  return <Dialog label="Connect to another Atlas" onClose={busy ? () => undefined : onClose} className="connect-dialog">
    <h2 className="dialog-title">Connect to another Atlas</h2>
    {!paired ? <form onSubmit={event => { event.preventDefault(); void connect(); }}>
      <p className="muted">On the other computer, choose <strong>File › Remote Access…</strong>, turn remote access on and create a pairing link. Paste the link here, or type its address and code. The link works once, for five minutes.</p>
      <label className="field-label" htmlFor="connect-link">Pairing link or address</label>
      <input id="connect-link" className="input field-input" value={link} onChange={event => setLink(event.target.value)} placeholder="http://100.64.1.2:7346/pair#token=…" autoFocus spellCheck={false} autoComplete="off" disabled={busy} />
      {needsCode && <>
        <label className="field-label" htmlFor="connect-code">Pairing code</label>
        <input id="connect-code" className="input field-input" value={code} onChange={event => setCode(event.target.value)} placeholder="XXXX-XXXX-XXXX-XXXX" spellCheck={false} autoComplete="off" disabled={busy} />
      </>}
      <p className="muted field-note">Use the Tailscale address to connect from anywhere on your tailnet. On a local network, the connection is not encrypted.</p>
      {error && <div className="flash flash-danger" role="alert">{error}</div>}
      <div className="dialog-actions">
        <button type="button" className="btn" onClick={onClose} disabled={busy}>Cancel</button>
        <button type="submit" className="btn btn-primary" disabled={busy || !link.trim() || (needsCode && !code.trim())}>{busy ? <Spinner /> : 'Connect'}</button>
      </div>
    </form> : <Paired computer={paired} onClose={onClose} onBrowse={onBrowse} />}
  </Dialog>;
}

/** Paired: open one of that computer's planning folders, or browse it for another. */
function Paired({ computer, onClose, onBrowse }: { computer: Computer; onClose(): void; onBrowse(computer: ComputerRef & { hostId: string }): void }) {
  const { folders, error: listError } = useComputerFolders(computer.hostId);
  const [error, setError] = useState('');
  const target = { hostId: computer.hostId!, name: computer.name };
  return <>
    <p>This computer is paired with <strong>{computer.name}</strong>. Choose <strong>{computer.name}</strong> at the top of the explorer to work on it{computer.manageAccess ? '; you can also pair and revoke its devices' : ''}.</p>
    {folders === null ? <div className="menu-loading"><Spinner />Loading its planning folders…</div>
      : folders.length ? <FolderList computer={computer} folders={folders} onError={setError} onOpened={onClose} />
      : <p className="muted">{listError || 'No planning folders were opened on ' + computer.name + ' yet.'}</p>}
    {error && <div className="flash flash-danger" role="alert">{error}</div>}
    <div className="dialog-actions">
      <button type="button" className="btn" onClick={onClose}>Close</button>
      <button type="button" className="btn btn-primary" onClick={() => onBrowse(target)}><FileDirectoryIcon size={16} />Open Folder on {computer.name}…</button>
    </div>
  </>;
}
