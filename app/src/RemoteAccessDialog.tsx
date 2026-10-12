// File › Remote Access…: let your other devices use this computer's planning folders. Off by
// default. The owner picks how the computer is reached (Tailscale, a local network, or only this
// machine), creates five-minute one-time pairing links shown with a QR code, and revokes paired
// devices. A paired device gets the whole computer; the pairing link may also grant it Manage
// access, so it can pair and revoke devices itself. In a window on another computer, the dialog
// manages that computer's pairings, when this app was granted Manage access there.
import { useEffect, useState } from 'react';
import { AlertIcon, CheckIcon, CopyIcon } from './icons';
import type { AccessSettings, AccessState, ComputerRef, PairedDevice, PairingLinkView } from './types';
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

export function RemoteAccessDialog({ onClose, computer }: { onClose(): void; computer: ComputerRef }) {
  const here = computer.hostId === null;
  const [state, setState] = useState<AccessState | null>(null);
  const [devices, setDevices] = useState<PairedDevice[] | null>(null);
  const [link, setLink] = useState<PairingLinkView | null>(null);
  const [label, setLabel] = useState('');
  const [manageAccess, setManageAccess] = useState(false);
  const [port, setPort] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [refused, setRefused] = useState('');
  const [confirming, setConfirming] = useState<string | null>(null);
  const [now, setNow] = useState(Date.now());

  const refreshDevices = () => { api.devices(computer.hostId).then(setDevices).catch(() => setDevices([])); };
  useEffect(() => {
    api.accessState(computer.hostId).then(next => { setState(next); setPort(String(next.settings.network.port)); refreshDevices(); }).catch(failure => {
      // Another computer that did not grant this one Manage access.
      if ((failure as { code?: string }).code === 'forbidden') setRefused((failure as Error).message); else setError((failure as Error).message);
    });
    return api.onAccessChanged(change => { if (change.hostId === computer.hostId) { setState(change.state); refreshDevices(); } });
  }, [computer.hostId]);
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
  const chosen = state?.addresses.find(entry => entry.address === (here ? address : state.status.address));
  const remaining = link ? Math.max(0, Date.parse(link.expiresAt) - now) : 0;

  const createLink = async () => {
    setBusy(true); setError('');
    try { setLink(await api.createPairing(computer.hostId, null, { label: label.trim() || null, manageAccess })); setNow(Date.now()); }
    catch (failure) { setError((failure as Error).message); }
    finally { setBusy(false); }
  };
  const revokeLink = async () => {
    if (!link) return;
    await api.revokePairing(computer.hostId, link.code).catch(() => undefined);
    setLink(null);
  };
  const revokeDevice = async (deviceId: string) => {
    setConfirming(null);
    try { await api.revokeDevice(computer.hostId, deviceId); refreshDevices(); }
    catch (failure) { setError((failure as Error).message); }
  };
  const savePort = () => {
    const value = Number(port);
    if (!settings || value === settings.network.port) return;
    if (!Number.isInteger(value) || value < 1024 || value > 65535) { setError('Choose a port from 1024 to 65535.'); return; }
    void apply(next => ({ ...next, network: { ...next.network, port: value } }));
  };

  const title = here ? 'Remote access' : 'Remote access to ' + computer.name;
  return <Dialog label={title} onClose={onClose} className="remote-access-dialog">
    <h2 className="dialog-title">{title}</h2>
    {refused ? <>
      <div className="flash flash-warning" role="alert"><AlertIcon size={16} /><p>{refused}</p></div>
      <div className="dialog-actions"><button type="button" className="btn" onClick={onClose}>Close</button></div>
    </> : !state ? (error ? <div className="flash flash-danger" role="alert">{error}</div> : <div className="menu-loading"><Spinner />Loading…</div>) : <>
      <p className="muted">{here
        ? 'Pair your other devices, such as your laptop, to work on this computer from them: they browse its folders, open any planning folder, and import and export plans, as Atlas does here. Pair only your own devices.'
        : `Pair your other devices with ${computer.name}, and revoke the ones that should no longer reach it. Only Atlas on ${computer.name} changes how it is reached.`}</p>
      {state.problem ? <div className="flash flash-danger" role="alert"><AlertIcon size={16} /><p>{state.problem}</p></div>
        : state.managedBy && <div className="flash flash-warning"><AlertIcon size={16} /><p>Remote access on this computer is managed by {state.managedBy}. Quit it, and Atlas takes over here within a few seconds.</p></div>}

      {here ? <section className="access-section" aria-label="Network">
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
      </section> : <p className={'access-status ' + (state.status.listening ? 'is-on' : '')} role="status">
        {state.status.listening ? `${computer.name} listens on ${state.status.address}:${state.status.port}.` : `Remote access is off on ${computer.name}.`}
      </p>}

      <section className="access-section" aria-label="Pair a device">
        <h3 className="dialog-subtitle">Pair a device</h3>
        {link && remaining > 0 ? <div className="pairing">
          {link.qrSvg && <img className="pairing-qr" src={'data:image/svg+xml;utf8,' + encodeURIComponent(link.qrSvg)} alt="QR code of the pairing link" />}
          <div className="pairing-text">
            <p className="pairing-expiry">Expires in {Math.floor(remaining / 60000)}:{String(Math.floor(remaining / 1000) % 60).padStart(2, '0')} · works once</p>
            <p className="pairing-grant">{link.label ? <strong>{link.label}: </strong> : null}the whole computer{link.manageAccess ? ', and Manage access' : ''}.</p>
            <code className="pairing-link">{link.url}</code>
            <div className="access-actions">
              {link.url && <CopyButton text={link.url} label="Copy link" />}
              <CopyButton text={link.code} label="Copy code only" />
              <button type="button" className="btn btn-sm btn-danger" onClick={() => void revokeLink()}>Revoke</button>
            </div>
            <p className="muted field-note">In Atlas on the other device, choose <strong>File › Connect to Another Atlas…</strong> and paste the link. Treat it like a password.</p>
          </div>
        </div> : <form className="pairing-form" onSubmit={event => { event.preventDefault(); void createLink(); }}>
          {link && <p className="muted">That pairing link expired.</p>}
          <label className="field-label" htmlFor="pairing-label">Device label <span className="muted">(optional)</span></label>
          <input id="pairing-label" className="input field-input pairing-label" value={label} maxLength={80} onChange={event => setLabel(event.target.value)} placeholder="e.g. Work laptop" spellCheck={false} autoComplete="off" disabled={busy || managed} />
          <fieldset className="pairing-permissions">
            <legend className="field-label">Permissions</legend>
            <p className="pairing-permission is-fixed"><CheckIcon size={16} /><span><strong>Use this computer</strong><span className="muted">Browse its folders, open any planning folder, import and export plans. Every paired device can.</span></span></p>
            <label className="pairing-permission">
              <input type="checkbox" checked={manageAccess} disabled={busy || managed} onChange={event => setManageAccess(event.target.checked)} />
              <span><strong>Manage access</strong><span className="muted">Create pairing links, and list and revoke paired devices.</span></span>
            </label>
          </fieldset>
          {chosen?.kind === 'lan' && <p className="access-note access-warning"><AlertIcon size={16} /><span>This link works over a local network, where the connection is not encrypted. Someone on that network who captures the device’s traffic could use {here ? 'this computer' : computer.name} as that device until you revoke it. Prefer Tailscale.</span></p>}
          <button type="submit" className="btn btn-primary" disabled={busy || managed || !state.status.listening}>Create pairing link</button>
          {!state.status.listening && <p className="muted field-note">{here ? 'Turn remote access on first.' : `Remote access is off on ${computer.name}.`}</p>}
        </form>}
      </section>

      <section className="access-section" aria-label="Paired devices">
        <h3 className="dialog-subtitle">Paired devices</h3>
        {devices === null ? <Spinner /> : devices.length ? <ul className="access-list device-list">{devices.map(device => <li key={device.deviceId}>
          <div className="device-main">
            <span className="device-name"><strong>{device.name}</strong>{device.scopes.includes('access:manage') && <Label tone="accent">Manage access</Label>}</span>
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
