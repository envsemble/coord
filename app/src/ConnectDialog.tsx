// Connect to Another Atlas…: pair with another computer's Atlas from its pairing link (or its
// address and code). That computer is then one of the computers this app works on: its projects
// show in a window that chooses it in the computer menu.
import { useState } from 'react';
import { Button, Dialog, Input, Notice, Text } from '@envsemble/envui';
import { ComputerIcon } from './icons';
import type { Computer } from './types';
import { api } from './api';

export function ConnectDialog({ onClose }: { onClose(): void }) {
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
    catch (failure) { if ((failure as { code?: string }).code !== 'cancelled') setError((failure as Error).message); }
    finally { setBusy(false); }
  };
  const close = (open: boolean) => { if (!open && !busy) onClose(); };
  if (paired) return <Paired computer={paired} onClose={onClose} />;
  return <Dialog open onOpenChange={close} pending={busy} className="connect-dialog" title="Connect to another Atlas"
    description={<>On the other computer, choose <strong>Remote Access…</strong>, turn remote access on and create a pairing link. Paste the link here, or type its address and code. The link works once, for five minutes.</>}
    closeLabel="Cancel" actions={<Button variant="primary" type="submit" form="connect-form" pending={busy} disabled={!link.trim() || (needsCode && !code.trim())}>Connect</Button>}>
    <form id="connect-form" className="dialog-form" onSubmit={event => { event.preventDefault(); void connect(); }}>
      <Input label="Pairing link or address" value={link} onChange={event => setLink(event.target.value)} placeholder="http://100.64.1.2:7346/pair#token=…" autoFocus spellCheck={false} autoComplete="off" disabled={busy}
        hint="Use the Tailscale address to connect from anywhere on your tailnet. On a local network, the connection is not encrypted." />
      {needsCode && <Input label="Pairing code" value={code} onChange={event => setCode(event.target.value)} placeholder="XXXX-XXXX-XXXX-XXXX" spellCheck={false} autoComplete="off" disabled={busy} />}
      {error && <Notice tone="error" announce>{error}</Notice>}
    </form>
  </Dialog>;
}

/** Paired: show that computer's projects in this window, or later from the computer menu. */
function Paired({ computer, onClose }: { computer: Computer; onClose(): void }) {
  const [error, setError] = useState('');
  const show = () => { api.switchComputer(computer.hostId, false).then(onClose, failure => setError((failure as Error).message)); };
  return <Dialog open onOpenChange={open => { if (!open) onClose(); }} className="connect-dialog" title="Connect to another Atlas"
    actions={<Button variant="primary" startIcon={<ComputerIcon />} onClick={show}>Show {computer.name}</Button>}>
    <Text>This computer is paired with <strong>{computer.name}</strong>. Choose <strong>{computer.name}</strong> in the computer menu at the top of a window to work on its projects{computer.manageAccess ? '; you can also pair and revoke its devices' : ''}.</Text>
    {error && <Notice tone="error" announce>{error}</Notice>}
  </Dialog>;
}
