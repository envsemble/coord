// Choosing where to work: the computer menu in the title bar (this computer and the paired ones,
// like Platform's organization menu), and the list of computers behind it. Choosing in the menu
// shows that computer's projects in this window; the list also opens a computer in a new window, and
// forgets computers.
import { createContext, useContext, useEffect, useRef, useState } from 'react';
import { Badge, Button, ConfirmButton, Dialog, GroupedRows, IconButton, Menu, MenuGroup, MenuItem, MenuRadioGroup, MenuRadioItem, MenuSeparator, Row, Spinner, Tooltip, useToast } from '@envsemble/envui';
import { UnfoldMore } from '@envsemble/envui/icons/UnfoldMore';
import { AddIcon, ComputerIcon, DevicesIcon, NewWindowIcon } from '../ui/icons';
import type { Computer, ComputerRef } from '../types';
import { api } from '../api';

/** Window-wide actions the menus start: pairing, remote access, the computers and About. */
export interface AppActions {
  connect(): void;
  remoteAccess(): void;
  manageComputers(): void;
  /** The menu's About Atlas. */
  about(): void;
}
const nothing = () => undefined;
export const AppActionsContext = createContext<AppActions>({ connect: nothing, remoteAccess: nothing, manageComputers: nothing, about: nothing });
export const useAppActions = () => useContext(AppActionsContext);

const statusLabels: Record<Computer['status'], string | null> = { online: null, connecting: 'Connecting', offline: 'Offline', revoked: 'Not paired', mismatch: 'Not the same computer', incompatible: 'Needs an update' };
const describe = (computer: Computer) => computer.hostId === null ? 'This computer' : computer.origin?.replace(/^https?:\/\//, '') ?? '';

/** The computers this app works on, checked each time the list opens. */
function useComputers(active: boolean, onError: (message: string) => void) {
  const [computers, setComputers] = useState<Computer[] | null>(null);
  const [checks, setChecks] = useState(0);
  useEffect(() => {
    if (!active) return;
    let current = true;
    // Opening shows a spinner; checking again keeps the list until the new one arrives.
    if (!checks) setComputers(null);
    api.computers().then(next => { if (current) setComputers(next); }, failure => { if (current) { setComputers([]); onError((failure as Error).message); } });
    return () => { current = false; };
  }, [active, checks]);
  return { computers, reload: () => setChecks(value => value + 1) };
}

function switchTo(computer: Computer, current: ComputerRef, newWindow: boolean, onError: (message: string) => void) {
  if (computer.hostId === current.hostId && !newWindow) return;
  api.switchComputer(computer.hostId, newWindow).catch(failure => { if ((failure as { code?: string }).code !== 'cancelled') onError((failure as Error).message); });
}

/** The computer this window works on, in the window's title bar. */
export function ComputerMenu({ current, onError }: { current: ComputerRef; onError(message: string): void }) {
  const [open, setOpen] = useState(false);
  const { computers } = useComputers(open, onError);
  const actions = useAppActions();
  return <Menu aria-label={'Computer: ' + current.name} align="start" density="compact" open={open} onOpenChange={setOpen}
    trigger={<Button variant="secondary" className="computer-trigger" startIcon={<ComputerIcon />} endIcon={<UnfoldMore />} aria-label={'Computer: ' + current.name}><span className="computer-trigger-label">{current.name}</span></Button>}>
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
    <MenuItem icon={<AddIcon />} onClick={actions.connect}>Connect to Another Atlas…</MenuItem>
    <MenuItem icon={<DevicesIcon />} onClick={actions.manageComputers}>Manage Computers…</MenuItem>
  </Menu>;
}

/** Computer menu › Manage computers…: open one in a new window, or forget a paired one. */
export function ComputersDialog({ current, onClose }: { current: ComputerRef; onClose(): void }) {
  const [error, setError] = useState('');
  const { computers, reload } = useComputers(true, setError);
  const actions = useAppActions();
  const toast = useToast();
  const rows = useRef<HTMLUListElement>(null);
  const refocus = useRef(false);
  // The computer being forgotten, whose row stays until the list reloads.
  const [forgetting, setForgetting] = useState<string | null>(null);
  // Forgetting the computer this window shows turns the window to this computer's projects, so the
  // list closes; otherwise it shows the computers that are left, and focus, which was on the
  // forgotten row, moves to the first action left in the list.
  const forget = (computer: Computer) => {
    setForgetting(computer.hostId);
    api.forgetRemote(computer.hostId!).then(() => {
      if (computer.hostId === current.hostId) onClose();
      else { refocus.current = true; reload(); }
    }, failure => { setForgetting(null); setError((failure as Error).message); });
  };
  useEffect(() => {
    const list = rows.current;
    if (!refocus.current || !list) return;
    refocus.current = false;
    setForgetting(null);
    // Unless the reader moved on, focus fell to the page or the dialog itself with the row.
    const focused = list.ownerDocument.activeElement;
    if (!focused?.matches('button:not(:disabled), a[href], input')) list.querySelector<HTMLElement>('button:not(:disabled)')?.focus();
  }, [computers]);
  // After the dialog closed, failures appear as a notice in the window.
  const report = (message: string) => toast.show({ message, variant: 'error' });
  return <Dialog open onOpenChange={open => { if (!open) onClose(); }} size="wide" title="Computers"
    description="This computer and the computers it is paired with. Choose one in the computer menu to work on it in this window."
    closeLabel="Done" actions={<Button variant="secondary" startIcon={<AddIcon />} onClick={() => { onClose(); actions.connect(); }}>Connect to Another Atlas…</Button>}>
    {computers === null ? <Spinner label="Checking computers" />
      : <GroupedRows ref={rows} className="computer-rows" aria-label="Computers">{computers.map(computer => {
        const status = statusLabels[computer.status];
        const pending = forgetting !== null && computer.hostId === forgetting;
        const usable = computer.status === 'online' && !pending;
        const here = computer.hostId === current.hostId;
        return <Row key={computer.hostId ?? 'local'} className="computer-row"
          title={<span className="row-title"><span className="row-link-title">{computer.name}</span>{status && <Badge tone={computer.status === 'connecting' ? 'neutral' : 'warning'}>{status}</Badge>}{here && <Badge tone="accent">This window</Badge>}</span>}
          detail={computer.detail ?? describe(computer)}
          action={<span className="row-actions">
            <Tooltip content="Open in a new window"><IconButton variant="text" icon={<NewWindowIcon />} aria-label={'Open ' + computer.name + ' in a new window'} disabled={!usable} onClick={() => { onClose(); switchTo(computer, current, true, report); }} /></Tooltip>
            {computer.hostId !== null && <ConfirmButton variant="text" disabled={pending} confirmLabel={'Forget ' + computer.name} onConfirm={() => forget(computer)}>Forget</ConfirmButton>}
          </span>} />;
      })}</GroupedRows>}
    <p className="dialog-note">Windows that show a forgotten computer show this one instead. This computer must pair again to reach it.</p>
    {error && <p className="dialog-error" role="alert">{error}</p>}
  </Dialog>;
}
