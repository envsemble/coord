// Choosing where to work: the computer menu in the title bar (this computer and the paired ones, and
// Computer settings…), and Settings' list of the other computers behind it. Choosing in the menu shows
// that computer's projects in this window; the list also opens a computer in a new window, pairs with
// another computer and forgets computers.
import { useEffect, useRef, useState } from 'react';
import { Alert, Badge, Button, ConfirmButton, IconButton, List, Menu, Spinner, Text, Tooltip } from '@envsemble/envui';
import { IconUnfoldMore as UnfoldMore } from '@envsemble/envui/icons/UnfoldMore';
import { AddIcon, ComputerIcon, NewWindowIcon, SettingsIcon } from '../ui/icons';
import type { Computer, ComputerRef } from '../types';
import { api } from '../api';
import { ConnectDialog } from './ConnectDialog';

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

/** The computer this window works on, in the window's title bar: the computers to switch to, and their settings. */
export function ComputerMenu({ current, onError, onSettings }: { current: ComputerRef; onError(message: string): void; onSettings(): void }) {
  const [open, setOpen] = useState(false);
  const { computers } = useComputers(open, onError);
  return <Menu.Root aria-label={'Computer: ' + current.name} align="start" open={open} onOpenChange={setOpen}
    trigger={<Button variant="ghost" className="computer-trigger" startIcon={<ComputerIcon />} endIcon={<UnfoldMore />} aria-label={'Computer: ' + current.name}><span className="computer-trigger-label">{current.name}</span></Button>}>
    <Menu.Group label="Computers">
      {computers === null ? <Menu.Item disabled icon={<Spinner size="sm" label="" />}>Checking computers…</Menu.Item>
        : <Menu.RadioGroup value={current.hostId ?? 'local'} onValueChange={value => {
          const computer = computers.find(item => (item.hostId ?? 'local') === value);
          if (computer) switchTo(computer, current, false, onError);
        }}>
          {computers.map(computer => <Menu.RadioItem key={computer.hostId ?? 'local'} value={computer.hostId ?? 'local'} disabled={computer.status !== 'online'}
            description={[statusLabels[computer.status], describe(computer)].filter(Boolean).join(' · ')}>{computer.name}</Menu.RadioItem>)}
        </Menu.RadioGroup>}
    </Menu.Group>
    <Menu.Separator />
    <Menu.Item icon={<SettingsIcon />} onClick={onSettings}>Computer settings…</Menu.Item>
  </Menu.Root>;
}

/**
 * Settings › Computers › Other computers: the computers this one is paired with, each opened in a new
 * window or forgotten, and Connect to Another Coord… to pair with one more.
 */
export function OtherComputers({ current }: { current: ComputerRef }) {
  const [error, setError] = useState('');
  const { computers, reload } = useComputers(true, setError);
  const [connecting, setConnecting] = useState(false);
  const rows = useRef<HTMLUListElement>(null);
  const refocus = useRef(false);
  // The computer being forgotten, whose row stays until the list reloads.
  const [forgetting, setForgetting] = useState<string | null>(null);
  // Forgetting the computer this window shows turns the window to this computer's projects;
  // otherwise the list shows the computers that are left, and focus, which was on the forgotten row,
  // moves to the first action left in the list (or the section's button).
  const forget = (computer: Computer) => {
    setForgetting(computer.hostId);
    api.forgetComputer(computer.hostId!).then(() => {
      if (computer.hostId !== current.hostId) { refocus.current = true; reload(); }
    }, failure => { setForgetting(null); setError((failure as Error).message); });
  };
  useEffect(() => {
    if (!refocus.current || computers === null) return;
    refocus.current = false;
    setForgetting(null);
    // Unless the reader moved on, focus fell to the page with the row.
    const focused = document.activeElement;
    if (!focused || focused === document.body) (rows.current?.querySelector<HTMLElement>('button:not(:disabled)') ?? document.querySelector<HTMLElement>('.other-computers-connect'))?.focus();
  }, [computers]);
  const paired = computers?.filter(computer => computer.hostId !== null) ?? null;
  return <>
    <div className="section-toolbar">
      <Text variant="body-sm" emphasis="muted" className="settings-description">The computers this one is paired with. Choose one in the computer menu to work on it in this window.</Text>
      <Button variant="secondary" className="other-computers-connect" startIcon={<AddIcon />} onClick={() => setConnecting(true)}>Connect to Another Coord…</Button>
    </div>
    {paired === null ? <Spinner label="Checking computers" />
      : !paired.length ? <Text emphasis="muted">Not paired with another computer yet.</Text>
      : <List.Root ref={rows} className="computer-rows" aria-label="Other computers">{paired.map(computer => {
        const status = statusLabels[computer.status];
        const pending = forgetting !== null && computer.hostId === forgetting;
        const usable = computer.status === 'online' && !pending;
        const here = computer.hostId === current.hostId;
        return <List.Item key={computer.hostId} className="computer-row"
          label={<span className="row-title"><span className="row-link-title">{computer.name}</span>{status && <Badge tone={computer.status === 'connecting' ? 'neutral' : 'warning'}>{status}</Badge>}{here && <Badge tone="primary">This window</Badge>}</span>}
          description={computer.detail ?? describe(computer)}
          end={<span className="row-actions">
            <Tooltip content="Open in a new window"><IconButton variant="text" icon={<NewWindowIcon />} aria-label={'Open ' + computer.name + ' in a new window'} disabled={!usable} onClick={() => switchTo(computer, current, true, setError)} /></Tooltip>
            <ConfirmButton variant="text" disabled={pending} confirmLabel={'Forget ' + computer.name} onConfirm={() => forget(computer)}>Forget</ConfirmButton>
          </span>} />;
      })}</List.Root>}
    {paired !== null && paired.length > 0 && <p className="dialog-note">Windows that show a forgotten computer show this one instead. This computer must pair again to reach it.</p>}
    {error && <Alert tone="danger" announce className="dialog-error">{error}</Alert>}
    {connecting && <ConnectDialog onClose={() => { setConnecting(false); reload(); }} />}
  </>;
}
