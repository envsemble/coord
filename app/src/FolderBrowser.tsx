// Open a folder on another computer: its folders, browsed in Atlas (the system's dialog sees only
// this computer). Only folders are listed; planning folders (with a planning.json) are marked and
// open here or in a new window. Browsing starts beside the folder the window shows on that
// computer, or else at its home folder and drives.
import { useEffect, useState } from 'react';
import { ArrowUpIcon, FileDirectoryIcon, HomeIcon, LinkExternalIcon, ServerIcon } from './icons';
import type { BrowseResult, ComputerRef } from './types';
import { api } from './api';
import { Dialog } from './components/Dialog';
import { Label, Spinner } from './ui';

export function FolderBrowser({ computer, near, onClose }: { computer: ComputerRef & { hostId: string }; near: string | null; onClose(): void }) {
  // Undefined while the starting place (the folder beside `near`) is worked out.
  const [place, setPlace] = useState<string | null | undefined>(near ? undefined : null);
  const [listing, setListing] = useState<BrowseResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  useEffect(() => {
    if (!near) return;
    api.browse(computer.hostId, near).then(result => setPlace(result.parent ?? null), () => setPlace(null));
  }, [computer.hostId, near]);
  useEffect(() => {
    if (place === undefined) return;
    let current = true;
    setListing(null); setError('');
    api.browse(computer.hostId, place).then(result => { if (current) setListing(result); }, failure => { if (current) { setError((failure as Error).message); setListing({ path: place, parent: null, planning: false, folders: [], truncated: false }); } });
    return () => { current = false; };
  }, [computer.hostId, place]);
  const open = async (folder: string, newWindow: boolean) => {
    setBusy(true); setError('');
    try { await api.openFolder(computer.hostId, folder, newWindow); onClose(); }
    catch (failure) { setError((failure as Error).message); setBusy(false); }
  };
  const up = () => setPlace(listing?.parent ?? null);
  return <Dialog label={'Open a folder on ' + computer.name} onClose={busy ? () => undefined : onClose} className="folder-browser" placement="top">
    <h2 className="dialog-title">Open a folder on {computer.name}</h2>
    <div className="folder-browser-bar">
      <button type="button" className="btn btn-sm" onClick={() => setPlace(null)} disabled={busy || !place} aria-label="Home folder and drives" title="Home folder and drives"><HomeIcon size={16} /></button>
      <button type="button" className="btn btn-sm" onClick={up} disabled={busy || !place} aria-label="Up" title="Up one folder"><ArrowUpIcon size={16} /></button>
      <code className="folder-browser-path" title={place ?? undefined}><bdi>{place === undefined ? '' : place ?? 'Home folder and drives'}</bdi></code>
    </div>
    {listing?.planning && listing.path && <div className="folder-browser-current">
      <span><strong>This is a planning folder.</strong></span>
      <span className="access-actions">
        <button type="button" className="btn btn-sm btn-primary" disabled={busy} onClick={() => void open(listing.path!, false)}>Open</button>
        <button type="button" className="btn btn-sm" disabled={busy} onClick={() => void open(listing.path!, true)}>Open in New Window</button>
      </span>
    </div>}
    <div className="folder-browser-list" aria-busy={listing === null}>
      {listing === null ? <div className="menu-loading"><Spinner />Loading…</div>
        : listing.folders.length ? <ul className="folder-list" aria-label={place ? 'Folders in ' + place : 'Places'}>{listing.folders.map(folder => <li key={folder.path} className="menu-row">
          <button type="button" className="menu-item" disabled={busy} title={folder.path} onClick={() => setPlace(folder.path)}
            onKeyDown={event => { if (event.key === 'Enter' && (event.ctrlKey || event.metaKey) && folder.planning) { event.preventDefault(); void open(folder.path, true); } }}>
            <span className="menu-check">{place === null && folder.name !== 'Home' ? <ServerIcon size={16} /> : place === null ? <HomeIcon size={16} /> : <FileDirectoryIcon size={16} />}</span>
            <span className="menu-text"><span className="menu-item-heading"><strong>{folder.name}</strong>{folder.planning && <Label tone="accent">Planning folder</Label>}</span>
              {place === null && <span className="menu-description path"><bdi>{folder.path}</bdi></span>}</span>
          </button>
          {folder.planning && <>
            <button type="button" className="btn btn-sm menu-row-open" disabled={busy} onClick={() => void open(folder.path, false)} aria-label={'Open ' + folder.name}>Open</button>
            <button type="button" className="btn-octicon menu-row-action" disabled={busy} onClick={() => void open(folder.path, true)} aria-label={'Open ' + folder.name + ' in a new window'} title="Open in a new window (Ctrl+Enter)"><LinkExternalIcon size={16} /></button>
          </>}
        </li>)}</ul>
        : !error && <p className="muted folder-browser-empty">No folders here.</p>}
      {listing?.truncated && <p className="muted field-note">Showing the first {listing.folders.length} folders.</p>}
    </div>
    {error && <div className="flash flash-danger" role="alert">{error}</div>}
    <div className="dialog-actions"><button type="button" className="btn" onClick={onClose} disabled={busy}>Cancel</button></div>
  </Dialog>;
}
