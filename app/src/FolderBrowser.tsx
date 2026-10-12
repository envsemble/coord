// Open a folder on another computer: its folders, browsed in Atlas (the system's dialog sees only
// this computer). Only folders are listed; planning folders (with a planning.json) are marked and
// open here or in a new window. Browsing starts beside the folder the window shows on that
// computer, or else at its home folder and drives.
import { useEffect, useState } from 'react';
import { Badge, Button, Dialog, IconButton, NavigationItem, Notice, Spinner, Text, Tooltip } from '@envsemble/envui';
import { Code } from '@envsemble/envui/content';
import { ArrowUpIcon, FolderIcon, HomeIcon, NewWindowIcon, ServerIcon } from './icons';
import type { BrowseResult, ComputerRef } from './types';
import { api } from './api';

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
  return <Dialog open onOpenChange={value => { if (!value && !busy) onClose(); }} pending={busy} size="wide" placement="top" className="folder-browser"
    title={'Open a folder on ' + computer.name}
    actions={<Button variant="secondary" onClick={onClose} disabled={busy}>Cancel</Button>}>
    <div className="folder-browser-bar">
      <Tooltip content="Home folder and drives"><IconButton icon={<HomeIcon />} aria-label="Home folder and drives" onClick={() => setPlace(null)} disabled={busy || !place} /></Tooltip>
      <Tooltip content="Up one folder"><IconButton icon={<ArrowUpIcon />} aria-label="Up" onClick={up} disabled={busy || !place} /></Tooltip>
      <Code className="folder-browser-path" title={place ?? undefined}><bdi>{place === undefined ? '' : place ?? 'Home folder and drives'}</bdi></Code>
    </div>
    {listing?.planning && listing.path && <Notice tone="success" className="folder-browser-current" title="This is a planning folder."
      action={<span className="row-actions">
        <Button variant="primary" disabled={busy} onClick={() => void open(listing.path!, false)}>Open</Button>
        <Button variant="secondary" disabled={busy} onClick={() => void open(listing.path!, true)}>Open in New Window</Button>
      </span>} />}
    <div className="folder-browser-list" aria-busy={listing === null}>
      {listing === null ? <Spinner label="Loading folders" />
        : listing.folders.length ? <ul className="browser-list" aria-label={place ? 'Folders in ' + place : 'Places'}>{listing.folders.map(folder => <li key={folder.path} className="browser-row">
          <NavigationItem size="compact" disabled={busy} title={folder.path} onClick={() => setPlace(folder.path)}
            icon={place === null && folder.name !== 'Home' ? <ServerIcon /> : place === null ? <HomeIcon /> : <FolderIcon />}
            onKeyDown={event => { if (event.key === 'Enter' && (event.ctrlKey || event.metaKey) && folder.planning) { event.preventDefault(); void open(folder.path, true); } }}
            trailing={folder.planning ? <Badge tone="accent">Planning folder</Badge> : undefined}>
            {folder.name}{place === null && <span className="browser-row-path"> <bdi>{folder.path}</bdi></span>}
          </NavigationItem>
          {folder.planning && <span className="row-actions">
            <Button variant="secondary" disabled={busy} onClick={() => void open(folder.path, false)} aria-label={'Open ' + folder.name}>Open</Button>
            <Tooltip content="Open in a new window"><IconButton variant="text" icon={<NewWindowIcon />} disabled={busy} onClick={() => void open(folder.path, true)} aria-label={'Open ' + folder.name + ' in a new window'} /></Tooltip>
          </span>}
        </li>)}</ul>
        : !error && <Text tone="muted" className="folder-browser-empty">No folders here.</Text>}
      {listing?.truncated && <Text variant="caption" tone="muted">Showing the first {listing.folders.length} folders.</Text>}
    </div>
    {error && <Notice tone="error" role="alert">{error}</Notice>}
  </Dialog>;
}
