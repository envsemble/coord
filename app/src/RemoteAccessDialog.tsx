// File › Remote Access…: let paired devices read this computer's shared planning folders.
// Off by default. The owner picks how the computer is reached (Tailscale, a local network, or only
// this machine), shares folders, creates five-minute one-time pairing links shown with a QR code,
// and revokes paired devices. Every change applies at once.
import { useEffect, useMemo, useState } from 'react';
import { AlertIcon, CheckIcon, CopyIcon, FileDirectoryIcon, XIcon } from './icons';
import type { AccessSettings, AccessState, PairedDevice, PairingLinkView } from './types';
import { api } from './api';
import { absoluteDate, relativeDate } from './format';
import { Dialog } from './components/Dialog';
import { Label, Spinner } from './ui';

const platforms: Record<string, string> = { win32: 'Windows', linux: 'Linux', darwin: 'macOS', android: 'Android', ios: 'iOS' };

function CopyButton({ text, label }: { text: string; label: string }) {
  const [done, setDone] = useState(false);
  return <button type="button" className="btn btn-sm" onClick={() => { void api.copy(text).then(() => { setDone(true); window.setTimeout(() => setDone(false), 1500); }); }}>
    {done ? <CheckIcon size={16} /> : <CopyIcon size={16} />}{done ? 'Copied' : label}
  </button>;
}

export function RemoteAccessDialog({ onClose, currentFolder }: { onClose(): void; currentFolder: string | null }) {
  const [state, setState] = useState<AccessState | null>(null);
  const [devices, setDevices] = useState<PairedDevice[] | null>(null);
  const [link, setLink] = useState<PairingLinkView | null>(null);
  const [port, setPort] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [confirming, setConfirming] = useState<string | null>(null);
  const [now, setNow] = useState(Date.now());

  const refreshDevices = () => { api.devices().then(setDevices).catch(() => setDevices([])); };
  useEffect(() => {
    api.accessState().then(next => { setState(next); setPort(String(next.settings.network.port)); }).catch(failure => setError((failure as Error).message));
    refreshDevices();
    return api.onAccessChanged(next => { setState(next); refreshDevices(); });
  }, []);
  useEffect(() => {
    if (!link) return;
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [link]);

  const apply = async (change: (settings: AccessSettings) => AccessSettings) => {
    // One change at a time (Enter and then leaving the port field would otherwise apply it twice).
    if (!state || busy) return;
    setBusy(true); setError('');
    try {
      const next = await api.updateAccess(change(structuredClone(state.settings)));
      setState(next);
      setPort(String(next.settings.network.port));
      if (!next.status.listening) setLink(null);
    } catch (failure) { setError((failure as Error).message); }
    finally { setBusy(false); }
  };
  const settings = state?.settings;
  // Settings that cannot be changed here: another process manages them, or they cannot be read.
  const managed = Boolean(state?.managedBy) || Boolean(state?.problem);
  // Tailscale when this computer has it; otherwise only this machine, until the owner picks a network deliberately.
  const address = settings?.network.address ?? state?.addresses.find(entry => entry.kind === 'tailscale')?.address ?? '127.0.0.1';
  const chosen = state?.addresses.find(entry => entry.address === address);
  const shared = useMemo(() => new Set(settings?.sharedFolders ?? []), [settings]);
  const remaining = link ? Math.max(0, Date.parse(link.expiresAt) - now) : 0;

  const createLink = async () => {
    setBusy(true); setError('');
    try { setLink(await api.createPairing(null)); setNow(Date.now()); }
    catch (failure) { setError((failure as Error).message); }
    finally { setBusy(false); }
  };
  const revokeLink = async () => {
    if (!link) return;
    await api.revokePairing(link.code).catch(() => undefined);
    setLink(null);
  };
  const revokeDevice = async (deviceId: string) => {
    setConfirming(null);
    try { await api.revokeDevice(deviceId); refreshDevices(); }
    catch (failure) { setError((failure as Error).message); }
  };
  const savePort = () => {
    const value = Number(port);
    if (!settings || value === settings.network.port) return;
    if (!Number.isInteger(value) || value < 1024 || value > 65535) { setError('Choose a port from 1024 to 65535.'); return; }
    void apply(next => ({ ...next, network: { ...next.network, port: value } }));
  };

  return <Dialog label="Remote access" onClose={onClose} className="remote-access-dialog">
    <h2 className="dialog-title">Remote access</h2>
    {!state ? (error ? <div className="flash flash-danger" role="alert">{error}</div> : <div className="menu-loading"><Spinner />Loading…</div>) : <>
      <p className="muted">Let devices you pair, such as your other computer, read the planning folders you share. They can open them read-only; they cannot change anything here.</p>
      {state.problem ? <div className="flash flash-danger" role="alert"><AlertIcon size={16} /><p>{state.problem}</p></div>
        : state.managedBy && <div className="flash flash-warning"><AlertIcon size={16} /><p>Remote access on this computer is managed by {state.managedBy}. Quit it, and Atlas takes over here within a few seconds.</p></div>}

      <section className="access-section" aria-label="Network">
        <label className="access-toggle">
          <input type="checkbox" checked={settings!.network.enabled} disabled={busy || managed}
            onChange={event => { const enabled = event.target.checked; void apply(next => ({ ...next, network: { ...next.network, enabled, address: next.network.address ?? address } })); }} />
          <span>Allow paired devices to connect to this computer</span>
        </label>
        <div className="access-fields">
          <label className="field-label" htmlFor="access-address">Reach this computer via</label>
          <select id="access-address" className="select" value={address ?? ''} disabled={busy || managed}
            onChange={event => { const value = event.target.value; void apply(next => ({ ...next, network: { ...next.network, address: value } })); }}>
            {state.addresses.map(entry => <option key={entry.address} value={entry.address}>{entry.label} — {entry.address}</option>)}
          </select>
          <label className="field-label" htmlFor="access-port">Port</label>
          <input id="access-port" className="input access-port" inputMode="numeric" value={port} disabled={busy || managed}
            onChange={event => setPort(event.target.value.replace(/[^0-9]/g, '').slice(0, 5))} onBlur={savePort} onKeyDown={event => { if (event.key === 'Enter') savePort(); }} />
        </div>
        {chosen?.kind === 'lan' && <p className="access-note"><AlertIcon size={16} />On a local network, the connection is not encrypted. Prefer Tailscale, which encrypts it end to end.</p>}
        {chosen?.kind === 'loopback' && <p className="access-note muted">Only Atlas on this same computer can connect through this address.</p>}
        <p className={'access-status ' + (state.status.listening ? 'is-on' : state.status.error ? 'is-error' : '')} role="status">
          {state.status.listening ? `Listening on ${state.status.address}:${state.status.port}.` : state.status.error ?? 'Remote access is off.'}
        </p>
      </section>

      <section className="access-section" aria-label="Shared folders">
        <h3 className="dialog-subtitle">Shared planning folders</h3>
        {settings!.sharedFolders.length ? <ul className="access-list">{settings!.sharedFolders.map(folder => <li key={folder}>
          <FileDirectoryIcon size={16} /><span className="access-path" title={folder}>{folder}</span>
          <button type="button" className="btn-octicon" aria-label={'Stop sharing ' + folder} title="Stop sharing" disabled={busy || managed}
            onClick={() => void apply(next => ({ ...next, sharedFolders: next.sharedFolders.filter(item => item !== folder) }))}><XIcon size={16} /></button>
        </li>)}</ul> : <p className="muted">No folders are shared. Paired devices see nothing until you share one.</p>}
        <div className="access-actions">
          {currentFolder && !shared.has(currentFolder) && <button type="button" className="btn btn-sm" disabled={busy || managed} onClick={() => void apply(next => ({ ...next, sharedFolders: [...next.sharedFolders, currentFolder] }))}>Share this folder</button>}
          <button type="button" className="btn btn-sm" disabled={busy || managed} onClick={() => { void api.chooseSharedFolder().then(folder => { if (folder) void apply(next => ({ ...next, sharedFolders: [...new Set([...next.sharedFolders, folder])] })); }, failure => setError((failure as Error).message)); }}>Add folder…</button>
        </div>
      </section>

      <section className="access-section" aria-label="Pair a device">
        <h3 className="dialog-subtitle">Pair a device</h3>
        {link && remaining > 0 ? <div className="pairing">
          {link.qrSvg && <img className="pairing-qr" src={'data:image/svg+xml;utf8,' + encodeURIComponent(link.qrSvg)} alt="QR code of the pairing link" />}
          <div className="pairing-text">
            <p className="pairing-expiry">Expires in {Math.floor(remaining / 60000)}:{String(Math.floor(remaining / 1000) % 60).padStart(2, '0')} · works once</p>
            <code className="pairing-link">{link.url}</code>
            <div className="access-actions">
              {link.url && <CopyButton text={link.url} label="Copy link" />}
              <CopyButton text={link.code} label="Copy code only" />
              <button type="button" className="btn btn-sm btn-danger" onClick={() => void revokeLink()}>Revoke</button>
            </div>
            <p className="muted field-note">In Atlas on the other computer, choose <strong>File › Connect to Another Atlas…</strong> and paste the link. Treat it like a password.</p>
          </div>
        </div> : <>
          {link && <p className="muted">That pairing link expired.</p>}
          <button type="button" className="btn btn-primary" disabled={busy || managed || !state.status.listening} onClick={() => void createLink()}>Create pairing link</button>
          {!state.status.listening && <p className="muted field-note">Turn remote access on first.</p>}
        </>}
      </section>

      <section className="access-section" aria-label="Paired devices">
        <h3 className="dialog-subtitle">Paired devices</h3>
        {devices === null ? <Spinner /> : devices.length ? <ul className="access-list device-list">{devices.map(device => <li key={device.deviceId}>
          <div className="device-main">
            <strong>{device.name}</strong>
            <span className="muted">{platforms[device.platform] ?? device.platform} · paired {absoluteDate(device.pairedAt)}{device.lastSeenAt && !device.connected ? ' · last seen ' + relativeDate(device.lastSeenAt) : ''}</span>
          </div>
          {device.connected && <Label tone="success">Connected</Label>}
          {confirming === device.deviceId
            ? <span className="access-actions"><button type="button" className="btn btn-sm btn-danger" onClick={() => void revokeDevice(device.deviceId)} disabled={managed}>Revoke access</button><button type="button" className="btn btn-sm" onClick={() => setConfirming(null)}>Keep</button></span>
            : <button type="button" className="btn btn-sm" onClick={() => setConfirming(device.deviceId)} disabled={managed}>Revoke…</button>}
        </li>)}</ul> : <p className="muted">No paired devices.</p>}
      </section>
      {error && <div className="flash flash-danger" role="alert">{error}</div>}
      <div className="dialog-actions"><button type="button" className="btn" onClick={onClose}>Done</button></div>
    </>}
  </Dialog>;
}
