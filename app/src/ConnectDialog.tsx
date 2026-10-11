// File › Connect to Another Atlas…: pair with another computer's Atlas from its pairing link (or
// its address and code), then open one of the planning folders it shares. Folders on another
// computer open read-only.
import { useState } from 'react';
import { FileDirectoryIcon, LinkExternalIcon } from './icons';
import type { RemoteHost, SharedFolder } from './types';
import { api } from './api';
import { Dialog } from './components/Dialog';
import { Spinner } from './ui';

export function ConnectDialog({ onClose }: { onClose(): void }) {
  const [link, setLink] = useState('');
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [paired, setPaired] = useState<{ host: RemoteHost; folders: SharedFolder[] } | null>(null);
  // A pasted link carries its code; an address alone needs the code typed.
  const needsCode = link.trim() !== '' && !/#token=/.test(link);
  const connect = async () => {
    setBusy(true); setError('');
    try { setPaired(await api.pairRemote(link.trim(), needsCode ? code.trim() || null : null)); }
    catch (failure) { setError((failure as Error).message); }
    finally { setBusy(false); }
  };
  const open = async (folder: SharedFolder) => {
    setBusy(true); setError('');
    try { await api.openRemote(paired!.host.hostId, folder.folderId); onClose(); }
    catch (failure) { setError((failure as Error).message); setBusy(false); }
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
    </form> : <>
      <p>This computer is paired with <strong>{paired.host.name}</strong>. Its planning folders open read-only here.</p>
      {paired.folders.length ? <ul className="shared-folder-list">{paired.folders.map(folder => <li key={folder.folderId}>
        <button type="button" className="shared-folder" onClick={() => void open(folder)} disabled={busy}><FileDirectoryIcon size={16} /><span>{folder.name}</span><LinkExternalIcon size={16} className="shared-folder-open" /></button>
      </li>)}</ul> : <p className="muted">{paired.host.name} shares no planning folders yet. On it, choose <strong>File › Remote Access…</strong> and share a folder; it then appears on the welcome page here.</p>}
      {error && <div className="flash flash-danger" role="alert">{error}</div>}
      <div className="dialog-actions"><button type="button" className="btn" onClick={onClose} disabled={busy}>Close</button></div>
    </>}
  </Dialog>;
}
