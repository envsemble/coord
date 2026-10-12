// Choosing where to work: the computer menu at the top of the window (this computer and the paired
// ones, like Platform's organization menu), the folder menu above the explorer, and the lists behind
// them. Choosing in a menu opens in this window; the lists also open a computer or a folder in a new
// window, and remove folders or forget computers.
import { createContext, useCallback, useContext, useEffect, useState, type MouseEvent } from 'react';
import {
  Badge, Button, ConfirmButton, Dialog, EmptyState, GroupedRows, IconButton, Menu, MenuGroup, MenuItem, MenuRadioGroup, MenuRadioItem, MenuSeparator, Row, Spinner, Tooltip,
} from '@envsemble/envui';
import { UnfoldMore } from '@envsemble/envui/icons/UnfoldMore';
import { AddIcon, CloseIcon, ComputerIcon, DevicesIcon, FolderIcon, NewWindowIcon } from './icons';
import type { Computer, ComputerFolder, ComputerRef } from './types';
import { api } from './api';
import { plural, relativeDate } from './format';

/** Window-wide actions the menus start: pairing, the folder browser, remote access, and the lists. */
export interface AppActions {
  connect(): void;
  browse(computer: ComputerRef, near?: string | null): void;
  remoteAccess(): void;
  manageComputers(): void;
  manageFolders(computer: ComputerRef): void;
}
const nothing = () => undefined;
export const AppActionsContext = createContext<AppActions>({ connect: nothing, browse: nothing, remoteAccess: nothing, manageComputers: nothing, manageFolders: nothing });
export const useAppActions = () => useContext(AppActionsContext);

const statusLabels: Record<Computer['status'], string | null> = { online: null, connecting: 'Connecting', offline: 'Offline', revoked: 'Not paired', mismatch: 'Not the same computer', incompatible: 'Needs an update' };
/** Ctrl (⌘ on macOS) with a click: open in a new window. */
const wantsNewWindow = (event: { ctrlKey: boolean; metaKey: boolean }) => event.ctrlKey || event.metaKey;
const describe = (computer: Computer) => computer.hostId === null ? 'This computer' : computer.origin?.replace(/^https?:\/\//, '') ?? '';

/** A computer's folder list, kept current as it changes (on any device). */
export function useComputerFolders(hostId: string | null, active = true) {
  const [folders, setFolders] = useState<ComputerFolder[] | null>(null);
  const [error, setError] = useState('');
  const load = useCallback(() => {
    setError('');
    api.folders(hostId).then(setFolders, failure => { setFolders([]); setError((failure as Error).message); });
  }, [hostId]);
  useEffect(() => {
    if (!active) return;
    setFolders(null);
    load();
    return api.onFoldersChanged(change => { if (change.hostId === hostId) { setFolders(change.folders); setError(''); } });
  }, [hostId, active, load]);
  return { folders, error, reload: load };
}

/** The computers this app works on, checked each time the list opens. */
function useComputers(active: boolean, onError: (message: string) => void) {
  const [computers, setComputers] = useState<Computer[] | null>(null);
  useEffect(() => {
    if (!active) return;
    let current = true;
    setComputers(null);
    api.computers().then(next => { if (current) setComputers(next); }, failure => { if (current) { setComputers([]); onError((failure as Error).message); } });
    return () => { current = false; };
  }, [active]);
  return computers;
}

function switchTo(computer: Computer, current: ComputerRef, newWindow: boolean, onError: (message: string) => void) {
  if (computer.hostId === current.hostId && !newWindow) return;
  api.switchComputer(computer.hostId, newWindow).catch(failure => onError((failure as Error).message));
}

/** The computer this window works on, in the window's top bar. */
export function ComputerMenu({ current, onError }: { current: ComputerRef; onError(message: string): void }) {
  const [open, setOpen] = useState(false);
  const computers = useComputers(open, onError);
  const actions = useAppActions();
  return <Menu aria-label={'Computer: ' + current.name} align="start" open={open} onOpenChange={setOpen}
    trigger={<Button variant="secondary" className="computer-trigger" startIcon={<ComputerIcon />} endIcon={<UnfoldMore />}><span className="computer-trigger-label">{current.name}</span></Button>}>
    <MenuGroup label="Computers">
      {computers === null ? <MenuItem disabled icon={<Spinner size="small" label="" />}>Checking computers…</MenuItem>
        : <MenuRadioGroup value={current.hostId ?? 'local'} onValueChange={value => {
          const computer = computers.find(item => (item.hostId ?? 'local') === value);
          if (computer) switchTo(computer, current, false, onError);
        }}>
          {computers.map(computer => <MenuRadioItem key={computer.hostId ?? 'local'} value={computer.hostId ?? 'local'} disabled={computer.status !== 'online'}
            description={[statusLabels[computer.status], describe(computer)].filter(Boolean).join(' · ')}>{computer.name}</MenuRadioItem>)}
        </MenuRadioGroup>}
    </MenuGroup>
    <MenuSeparator />
    <MenuItem icon={<AddIcon />} onClick={actions.connect}>Connect to another computer…</MenuItem>
    <MenuItem icon={<DevicesIcon />} onClick={actions.manageComputers}>Manage computers…</MenuItem>
  </Menu>;
}

/** The folder name above the explorer: this computer's planning folders, opened in this window. */
export function FolderMenu({ computer, folderName, folderPath, isCurrent, onError }: { computer: ComputerRef; folderName: string; folderPath: string; isCurrent(folder: ComputerFolder): boolean; onError(message: string): void }) {
  const [open, setOpen] = useState(false);
  const { folders, error } = useComputerFolders(computer.hostId, open);
  const actions = useAppActions();
  const current = folders?.find(isCurrent);
  return <Menu aria-label={'Planning folder: ' + folderName} align="start" open={open} onOpenChange={setOpen}
    trigger={<Button variant="text" className="folder-trigger" endIcon={<UnfoldMore />}><span className="folder-trigger-label">{folderName}</span></Button>}>
    <MenuGroup label={'Planning folders on ' + computer.name}>
      {folders === null ? <MenuItem disabled icon={<Spinner size="small" label="" />}>Loading…</MenuItem>
        : folders.length ? <MenuRadioGroup value={current?.folderId ?? ''} onValueChange={value => {
          const folder = folders.find(item => item.folderId === value);
          if (folder) openFolder(computer, folder, false, onError);
        }}>
          {folders.map(folder => <MenuRadioItem key={folder.folderId} value={folder.folderId} disabled={!folder.available} description={folder.path}>
            {folder.name}{!folder.available && <> <Badge tone="warning">Missing</Badge></>}
          </MenuRadioItem>)}
        </MenuRadioGroup>
        : <MenuItem disabled>{error || 'No planning folders yet.'}</MenuItem>}
    </MenuGroup>
    <MenuSeparator />
    <MenuItem icon={<FolderIcon />} onClick={() => openFolderOn(computer, actions, onError, folderPath)}>Open Folder…</MenuItem>
    <MenuItem onClick={() => actions.manageFolders(computer)}>Manage folders…</MenuItem>
  </Menu>;
}

function openFolder(computer: ComputerRef, folder: ComputerFolder, newWindow: boolean, onError: (message: string) => void, onOpened?: () => void) {
  api.openFolder(computer.hostId, folder.path, newWindow).then(() => onOpened?.(), failure => { if ((failure as { code?: string }).code !== 'cancelled') onError((failure as Error).message); });
}

/** Open a folder that is not on the list yet: the system's dialog here, the in-app browser on another computer. */
export function openFolderOn(computer: ComputerRef, actions: AppActions, onError: (message: string) => void, near: string | null = null) {
  if (computer.hostId === null) api.chooseFolder(false).catch(failure => onError((failure as Error).message));
  else actions.browse(computer, near);
}

/**
 * One computer's folder list: open a folder in this window (Ctrl+click: a new one) or in a new
 * window, or take it off the list, which removes it for every device.
 */
export function FolderRows({ computer, folders, current, onError, onOpened }: {
  computer: ComputerRef; folders: ComputerFolder[]; current?: (folder: ComputerFolder) => boolean; onError(message: string): void; onOpened?(): void;
}) {
  const remove = (folder: ComputerFolder) => { api.removeFolder(computer.hostId, folder.folderId).catch(failure => onError((failure as Error).message)); };
  return <GroupedRows className="folder-rows" aria-label={'Planning folders on ' + computer.name}>{folders.map(folder => {
    const here = current?.(folder) ?? false;
    const facts = [folder.available ? folder.workItems !== null && plural(folder.workItems, 'work item') : null, folder.openedAt && 'opened ' + relativeDate(folder.openedAt)].filter(Boolean).join(' · ');
    return <Row key={folder.folderId} className="folder-row" data-current={here || undefined}
      title={<button type="button" className="row-link" disabled={!folder.available} aria-current={here || undefined} title={'Open ' + folder.path}
        onClick={(event: MouseEvent) => openFolder(computer, folder, wantsNewWindow(event), onError, onOpened)}>
        <span className="row-link-title">{folder.name}</span>
        {!folder.available && <Badge tone="warning">Missing</Badge>}
        {here && <Badge tone="accent">This window</Badge>}
      </button>}
      detail={<><bdi className="folder-row-path">{folder.path}</bdi>{facts && <span className="folder-row-facts">{facts}</span>}</>}
      action={<span className="row-actions">
        <Tooltip content="Open in a new window"><IconButton variant="text" icon={<NewWindowIcon />} aria-label={'Open ' + folder.name + ' in a new window'} disabled={!folder.available} onClick={() => openFolder(computer, folder, true, onError, onOpened)} /></Tooltip>
        <Tooltip content="Remove from the list on every device"><IconButton variant="text" icon={<CloseIcon />} aria-label={'Remove ' + folder.name + ' from the list'} onClick={() => remove(folder)} /></Tooltip>
      </span>} />;
  })}</GroupedRows>;
}

/** Folder menu › Manage folders…: the whole list for one computer. */
export function FoldersDialog({ computer, isCurrent, onClose }: { computer: ComputerRef; isCurrent?(folder: ComputerFolder): boolean; onClose(): void }) {
  const { folders, error: listError } = useComputerFolders(computer.hostId);
  const [error, setError] = useState('');
  const actions = useAppActions();
  return <Dialog open onOpenChange={open => { if (!open) onClose(); }} size="wide" title={'Planning folders on ' + computer.name}
    description="Every device that works on this computer sees the same list."
    actions={<>
      <Button variant="secondary" startIcon={<FolderIcon />} onClick={() => { onClose(); openFolderOn(computer, actions, setError); }}>Open Folder…</Button>
      <Button variant="primary" onClick={onClose}>Done</Button>
    </>}>
    {folders === null ? <Spinner label="Loading folders" />
      : folders.length ? <FolderRows computer={computer} folders={folders} current={isCurrent} onError={setError} onOpened={onClose} />
      : <EmptyState title="No planning folders yet" description={listError || 'Open a folder to add it.'} icon={<FolderIcon />} />}
    {error && <p className="dialog-error" role="alert">{error}</p>}
  </Dialog>;
}

/** Computer menu › Manage computers…: open one in a new window, or forget a paired one. */
export function ComputersDialog({ current, onClose }: { current: ComputerRef; onClose(): void }) {
  const [error, setError] = useState('');
  const computers = useComputers(true, setError);
  const actions = useAppActions();
  const forget = (computer: Computer) => { api.forgetRemote(computer.hostId!).catch(failure => setError((failure as Error).message)); };
  return <Dialog open onOpenChange={open => { if (!open) onClose(); }} size="wide" title="Computers"
    description="This computer and the computers it is paired with. Choose one in the computer menu to work on it in this window."
    actions={<>
      <Button variant="secondary" startIcon={<AddIcon />} onClick={() => { onClose(); actions.connect(); }}>Connect to another computer…</Button>
      <Button variant="primary" onClick={onClose}>Done</Button>
    </>}>
    {computers === null ? <Spinner label="Checking computers" />
      : <GroupedRows className="computer-rows" aria-label="Computers">{computers.map(computer => {
        const status = statusLabels[computer.status];
        const usable = computer.status === 'online';
        const here = computer.hostId === current.hostId;
        return <Row key={computer.hostId ?? 'local'} className="computer-row"
          title={<span className="row-title"><span className="row-link-title">{computer.name}</span>{status && <Badge tone={computer.status === 'connecting' ? 'neutral' : 'warning'}>{status}</Badge>}{here && <Badge tone="accent">This window</Badge>}</span>}
          detail={computer.detail ?? describe(computer)}
          action={<span className="row-actions">
            <Tooltip content="Open in a new window"><IconButton variant="text" icon={<NewWindowIcon />} aria-label={'Open ' + computer.name + ' in a new window'} disabled={!usable} onClick={() => { onClose(); switchTo(computer, current, true, setError); }} /></Tooltip>
            {computer.hostId !== null && <ConfirmButton variant="text" confirmLabel={'Forget ' + computer.name} onConfirm={() => forget(computer)}>Forget</ConfirmButton>}
          </span>} />;
      })}</GroupedRows>}
    <p className="dialog-note">Forgetting a computer closes the windows that show it. This computer must pair again to reach it.</p>
    {error && <p className="dialog-error" role="alert">{error}</p>}
  </Dialog>;
}
