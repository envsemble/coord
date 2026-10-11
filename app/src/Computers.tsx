// Choosing where to work: the computer menu (this computer and the paired ones, like Platform's
// organization menu), a computer's folder list, and the folder menu built on it. A folder or a
// computer opens in this window; the button beside it, or Ctrl+Enter, opens it in a new window.
import { createContext, useCallback, useContext, useEffect, useRef, useState, type KeyboardEvent, type ReactNode } from 'react';
import { CheckIcon, DeviceDesktopIcon, FileDirectoryIcon, LinkExternalIcon, PlusIcon, TriangleDownIcon, UnfoldIcon, XIcon } from './icons';
import type { Computer, ComputerFolder, ComputerRef } from './types';
import { api } from './api';
import { relativeDate } from './format';
import { Popover } from './components/Popover';
import { Label, Spinner } from './ui';

/** Window-wide actions the menus start: pairing, the folder browser, remote access. */
export interface AppActions { connect(): void; browse(computer: ComputerRef, near?: string | null): void; remoteAccess(): void }
export const AppActionsContext = createContext<AppActions>({ connect: () => undefined, browse: () => undefined, remoteAccess: () => undefined });
export const useAppActions = () => useContext(AppActionsContext);

const statusLabels: Record<Computer['status'], string | null> = { online: null, connecting: 'Connecting', offline: 'Offline', revoked: 'Not paired', mismatch: 'Not the same computer', incompatible: 'Needs an update' };
/** Ctrl (⌘ on macOS) with Enter or a click: open in a new window. */
const wantsNewWindow = (event: { ctrlKey: boolean; metaKey: boolean }) => event.ctrlKey || event.metaKey;
const onEnter = (open: (newWindow: boolean) => void) => (event: KeyboardEvent) => { if (event.key === 'Enter' && wantsNewWindow(event)) { event.preventDefault(); open(true); } };

/** A menu panel: focus starts on its first choice, and the arrow keys move between choices (Tab reaches the buttons beside them). */
function useMenuKeys() {
  const ref = useRef<HTMLDivElement>(null);
  const choices = () => [...(ref.current?.querySelectorAll<HTMLButtonElement>('button.menu-item:not(:disabled)') ?? [])];
  useEffect(() => { choices()[0]?.focus(); }, []);
  const onKeyDown = (event: KeyboardEvent) => {
    if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp' && event.key !== 'Home' && event.key !== 'End') return;
    const buttons = choices();
    if (!buttons.length) return;
    event.preventDefault();
    const index = buttons.indexOf(document.activeElement as HTMLButtonElement);
    const next = event.key === 'Home' ? 0 : event.key === 'End' ? buttons.length - 1 : (index + (event.key === 'ArrowDown' ? 1 : -1) + buttons.length) % buttons.length;
    buttons[next].focus();
  };
  return { ref, onKeyDown };
}

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
    return api.onFoldersChanged(change => { if (change.hostId === hostId) setFolders(change.folders); });
  }, [hostId, active, load]);
  return { folders, error, reload: load };
}

/** The pill at the top of the explorer and the welcome page: the computer this window works on. */
export function ComputerMenu({ current, onError, className = '' }: { current: ComputerRef; onError(message: string): void; className?: string }) {
  const [computers, setComputers] = useState<Computer[] | null>(null);
  const [forgetting, setForgetting] = useState<string | null>(null);
  const actions = useAppActions();
  const load = (open: boolean) => { setForgetting(null); if (open) { setComputers(null); api.computers().then(setComputers, failure => { setComputers([]); onError((failure as Error).message); }); } };
  const forget = (computer: Computer, close: () => void) => {
    close();
    api.forgetRemote(computer.hostId!).catch(failure => onError((failure as Error).message));
  };
  const choose = (computer: Computer, newWindow: boolean, close: () => void) => {
    close();
    if (computer.hostId === current.hostId && !newWindow) return;
    api.switchComputer(computer.hostId, newWindow).catch(failure => onError((failure as Error).message));
  };
  return <Popover label={'Computer: ' + current.name} title={'Working on ' + current.name} className={'computer-menu ' + className} buttonClassName="btn btn-sm computer-pill" onOpenChange={load}
    button={<><DeviceDesktopIcon size={16} /><span className="computer-pill-name">{current.name}</span><UnfoldIcon size={16} /></>}>
    {close => <MenuPanel className="computer-list">
      <div className="menu-title">Computers</div>
      {computers === null ? <div className="menu-loading"><Spinner />Checking computers…</div> : computers.map(computer => {
        const status = statusLabels[computer.status];
        const usable = computer.status === 'online';
        const checked = computer.hostId === current.hostId;
        if (forgetting !== null && forgetting === computer.hostId) return <div key={computer.hostId} className="menu-row menu-confirm" role="group" aria-label={'Forget ' + computer.name}>
          <span className="menu-text">Forget {computer.name}? Windows showing it close, and this computer must pair again to reach it.</span>
          <button type="button" className="btn btn-sm btn-danger" onClick={() => forget(computer, close)}>Forget</button>
          <button type="button" className="btn btn-sm" onClick={() => setForgetting(null)}>Keep</button>
        </div>;
        return <div key={computer.hostId ?? 'local'} className={'menu-row' + (checked ? ' is-current' : '')}>
          <button type="button" aria-current={checked || undefined} className="menu-item" disabled={!usable} title={computer.detail ?? undefined}
            onClick={event => choose(computer, wantsNewWindow(event), close)} onKeyDown={onEnter(newWindow => choose(computer, newWindow, close))}>
            <span className="menu-check">{checked && <CheckIcon size={16} />}</span>
            <span className="menu-text">
              <span className="menu-item-heading"><strong>{computer.name}</strong>{status && <Label tone={computer.status === 'connecting' ? 'muted' : 'attention'}>{status}</Label>}</span>
              <span className="menu-description">{computer.hostId === null ? 'This computer' : computer.origin?.replace(/^https?:\/\//, '')}</span>
            </span>
          </button>
          <button type="button" className="btn-octicon menu-row-action" aria-label={'Open ' + computer.name + ' in a new window'} title="Open in a new window (Ctrl+Enter)" disabled={!usable}
            onClick={() => choose(computer, true, close)}><LinkExternalIcon size={16} /></button>
          {computer.hostId !== null && <button type="button" className="btn-octicon menu-row-action" aria-label={'Forget ' + computer.name} title="Forget this computer" onClick={() => setForgetting(computer.hostId)}><XIcon size={16} /></button>}
        </div>;
      })}
      <div className="menu-separator" role="separator" />
      <button type="button" className="menu-item" onClick={() => { close(); actions.connect(); }}>
        <span className="menu-check"><PlusIcon size={16} /></span><span className="menu-text">Connect to another computer…</span>
      </button>
    </MenuPanel>}
  </Popover>;
}

/** The inside of a menu popover. */
function MenuPanel({ className, children }: { className: string; children: ReactNode }) {
  const { ref, onKeyDown } = useMenuKeys();
  return <div ref={ref} className={'action-menu ' + className} onKeyDown={onKeyDown}>{children}</div>;
}

/** One computer's folder list: open a folder here or in a new window, or take it off the list (for every device). */
export function FolderList({ computer, folders, current, onError, onOpened, compact = false }: {
  computer: ComputerRef; folders: ComputerFolder[]; current?: (folder: ComputerFolder) => boolean; onError(message: string): void; onOpened?(): void; compact?: boolean;
}) {
  const open = (folder: ComputerFolder, newWindow: boolean) => {
    api.openFolder(computer.hostId, folder.path, newWindow).then(() => onOpened?.(), failure => { if ((failure as { code?: string }).code !== 'cancelled') onError((failure as Error).message); });
  };
  const remove = (folder: ComputerFolder) => { api.removeFolder(computer.hostId, folder.folderId).catch(failure => onError((failure as Error).message)); };
  return <ul className={'folder-list' + (compact ? ' is-compact' : '')} aria-label={'Planning folders on ' + computer.name}>{folders.map(folder => {
    const checked = current?.(folder) ?? false;
    return <li key={folder.folderId} className={'menu-row' + (checked ? ' is-current' : '')}>
      <button type="button" className="menu-item folder-list-item" disabled={!folder.available} aria-current={checked || undefined} title={folder.path}
        onClick={event => open(folder, wantsNewWindow(event))} onKeyDown={onEnter(newWindow => open(folder, newWindow))}>
        <span className="menu-check">{checked ? <CheckIcon size={16} /> : <FileDirectoryIcon size={16} />}</span>
        <span className="menu-text">
          <span className="menu-item-heading"><strong>{folder.name}</strong>{!folder.available && <Label tone="attention">Missing</Label>}
            {folder.available && folder.workItems !== null && <span className="muted">{folder.workItems} work {folder.workItems === 1 ? 'item' : 'items'}</span>}</span>
          <span className="menu-description path"><bdi>{folder.path}</bdi></span>
        </span>
        {!compact && folder.openedAt && <span className="muted folder-list-date">{relativeDate(folder.openedAt)}</span>}
      </button>
      <button type="button" className="btn-octicon menu-row-action" aria-label={'Open ' + folder.name + ' in a new window'} title="Open in a new window (Ctrl+Enter)" disabled={!folder.available} onClick={() => open(folder, true)}><LinkExternalIcon size={16} /></button>
      <button type="button" className="btn-octicon menu-row-action" aria-label={'Remove ' + folder.name + ' from the list'} title={'Remove from the folder list (on every device)'} onClick={() => remove(folder)}><XIcon size={16} /></button>
    </li>;
  })}</ul>;
}

/** Open a folder that is not on the list yet: the system's dialog here, the in-app browser on another computer. */
export function openFolderOn(computer: ComputerRef, actions: AppActions, onError: (message: string) => void, near: string | null = null) {
  if (computer.hostId === null) api.chooseFolder(false).catch(failure => onError((failure as Error).message));
  else actions.browse(computer, near);
}

/** The folder name at the top of the explorer: a menu of this computer's planning folders. */
export function FolderMenu({ computer, folderName, folderPath, isCurrent, onError }: { computer: ComputerRef; folderName: string; folderPath: string; isCurrent(folder: ComputerFolder): boolean; onError(message: string): void }) {
  const [open, setOpen] = useState(false);
  const { folders, error } = useComputerFolders(computer.hostId, open);
  const actions = useAppActions();
  return <Popover label={'Planning folder: ' + folderName} title={'Planning folders on ' + computer.name} className="folder-menu" buttonClassName="explorer-title folder-menu-button" onOpenChange={setOpen}
    button={<><span className="folder-menu-name">{folderName}</span><TriangleDownIcon size={16} /></>}>
    {close => <MenuPanel className="folder-menu-panel">
      <div className="menu-title">Planning folders on {computer.name}</div>
      {folders === null ? <div className="menu-loading"><Spinner />Loading…</div>
        : folders.length ? <FolderList computer={computer} folders={folders} current={isCurrent} onError={message => { close(); onError(message); }} onOpened={close} compact />
        : <p className="menu-loading">No planning folders yet.</p>}
      {error && <p className="menu-error">{error}</p>}
      <div className="menu-separator" role="separator" />
      <button type="button" className="menu-item" onClick={() => { close(); openFolderOn(computer, actions, onError, folderPath); }}>
        <span className="menu-check"><FileDirectoryIcon size={16} /></span><span className="menu-text">Open Folder…</span>
      </button>
    </MenuPanel>}
  </Popover>;
}
