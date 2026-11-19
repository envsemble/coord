// Devices that can reach a computer, in Settings › Computers: let your other devices use this
// computer's projects. Off by default. The owner picks how the computer is reached (Tailscale, a
// local network, or only this machine), creates five-minute one-time pairing links shown with a QR
// code, and revokes paired devices. A paired device gets the whole computer; the pairing link may
// also grant it Manage access, so it can pair and revoke devices itself. In a window on another
// computer, the section manages that computer's pairings, when this app was granted Manage access there.
import { useEffect, useState } from 'react';
import { Alert, Badge, Button, Checkbox, Code, ConfirmButton, Graphic, List, Select, Spinner, Surface, Switch, Text, TextField } from '@envsemble/envui';
import type { AccessSettings, AccessState, ComputerRef, PairedDevice, PairingLinkView } from '../types';
import { api } from '../api';
import { absoluteDate, relativeDate } from '../ui/format';
import { CopyButton } from '../ui/CopyButton';

const platforms: Record<string, string> = { win32: 'Windows', linux: 'Linux', darwin: 'macOS', android: 'Android', ios: 'iOS' };

/** The heading of the section, which names the computer the devices reach. */
export const remoteAccessTitle = (computer: ComputerRef) => 'Devices that can reach ' + computer.name;

export function RemoteAccess({ computer }: { computer: ComputerRef }) {
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
    } catch (failure) {
      if ((failure as { code?: string }).code !== 'cancelled') setError((failure as Error).message);
      else setPort(String(state.settings.network.port));
    }
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
    catch (failure) { if ((failure as { code?: string }).code !== 'cancelled') setError((failure as Error).message); }
    finally { setBusy(false); }
  };
  const revokeLink = async () => {
    if (!link) return;
    await api.revokePairing(computer.hostId, link.code).catch(() => undefined);
    setLink(null);
  };
  const revokeDevice = async (deviceId: string) => {
    try { await api.revokeDevice(computer.hostId, deviceId); refreshDevices(); }
    catch (failure) { if ((failure as { code?: string }).code !== 'cancelled') setError((failure as Error).message); }
  };
  // The port as committed (Enter, or leaving the field); one out of range stays in the field to correct.
  const savePort = (text: string) => {
    const value = Number(text);
    if (!settings || value === settings.network.port) return;
    // A change already applying takes this one too late: the field keeps it, for Enter to try again.
    if (busy) return false;
    if (!Number.isInteger(value) || value < 1024 || value > 65535) { setError('Choose a port from 1024 to 65535.'); return false; }
    void apply(next => ({ ...next, network: { ...next.network, port: value } }));
  };

  if (refused) return <Alert tone="warning" announce>{refused}</Alert>;
  return <>
    <Text variant="body-sm" emphasis="muted" className="settings-description">{here
      ? 'Pair your other devices, such as your laptop, to work on this computer from them: they work on its projects and create new ones, as Coord does here. Pair only your own devices.'
      : `Pair your other devices with ${computer.name}, and revoke the ones that should no longer reach it. Only Coord on ${computer.name} changes how it is reached.`}</Text>
    {!state ? (error ? <Alert tone="danger" announce>{error}</Alert> : <Spinner label="Loading remote access" />) : <>
      {state.problem ? <Alert tone="danger" announce>{state.problem}</Alert>
        : state.managedBy && <Alert tone="warning">Remote access on this computer is managed by {state.managedBy}. Quit it, and Coord takes over here within a few seconds.</Alert>}

      {here ? <section className="access-section" aria-label="Network">
        {/* Each setting applies as it changes: the switch in a row that names it, the fields on a raised surface under it, their labels above. */}
        <List.Root className="settings-rows" aria-label="Network">
          <List.Item className="settings-row" label="Allow paired devices to connect to this computer"
            description={<span className="access-status" data-state={state.status.listening ? 'on' : state.status.error ? 'error' : 'off'} role="status">
              {state.status.listening ? `Listening on ${state.status.address}:${state.status.port}.` : state.status.error ?? 'Remote access is off.'}
            </span>}
            control={<Switch checked={settings!.network.enabled} disabled={busy || managed}
              onCheckedChange={enabled => void apply(next => ({ ...next, network: { ...next.network, enabled, address: next.network.address ?? address } }))} />} />
        </List.Root>
        <Surface background="raised"><div className="settings-fields">
          <Select className="access-address" label="Reach this computer via" value={address ?? ''} disabled={busy || managed}
            description={chosen?.kind === 'loopback' ? 'Only Coord on this same computer can connect through this address.'
              : chosen?.kind === 'lan' ? 'A local network: the connection is not encrypted.' : 'The network paired devices find this computer on.'}
            onValueChange={value => { if (value) void apply(next => ({ ...next, network: { ...next.network, address: value } })); }}
            items={state.addresses.map(entry => ({ value: entry.address, label: `${entry.label} — ${entry.address}` }))} />
          <TextField className="access-port" label="Port" description="From 1024 to 65535. It applies when you leave the field or press Enter." inputMode="numeric" value={port} disabled={busy || managed}
            onValueChange={value => setPort(value.replace(/[^0-9]/g, '').slice(0, 5))} onValueCommitted={savePort} />
        </div></Surface>
        {chosen?.kind === 'lan' && <Alert tone="warning">On a local network, the connection is not encrypted. Prefer Tailscale, which encrypts it end to end.</Alert>}
      </section> : <p className="access-status" data-state={state.status.listening ? 'on' : 'off'} role="status">
        {state.status.listening ? `${computer.name} listens on ${state.status.address}:${state.status.port}.` : `Remote access is off on ${computer.name}.`}
      </p>}

      <section className="access-section" aria-label="Pair a device">
        <Text render={<h3 />} variant="body" className="settings-subheading">Pair a device</Text>
        {link && remaining > 0 ? <div className="pairing">
          {link.qrSvg && <span className="pairing-qr"><Graphic src={'data:image/svg+xml;utf8,' + encodeURIComponent(link.qrSvg)} alt="QR code of the pairing link" size="fill" aspect={1} fit="contain" /></span>}
          <div className="pairing-text">
            <p className="pairing-expiry">Expires in {Math.floor(remaining / 60000)}:{String(Math.floor(remaining / 1000) % 60).padStart(2, '0')} · works once</p>
            <p className="pairing-grant">{link.label ? <strong>{link.label}: </strong> : null}the whole computer{link.manageAccess ? ', and Manage access' : ''}.</p>
            <Code className="pairing-link">{link.url}</Code>
            <div className="row-actions">
              {link.url && <CopyButton text={link.url} label="Copy link" />}
              <CopyButton text={link.code} label="Copy code only" />
              <Button variant="outline" tone="danger" onClick={() => void revokeLink()}>Revoke</Button>
            </div>
            <Text variant="caption" emphasis="muted">In Coord on the other device, choose <strong>Connect to Another Coord…</strong> in <strong>Settings › Computers</strong> and paste the link. Treat it like a password.</Text>
          </div>
        </div> : !state.status.listening ? <Text variant="body-sm" emphasis="muted" className="settings-description">{here
          ? settings!.network.enabled ? 'This computer is not listening yet: its status is above. Pairing links can be created once it listens.'
            : 'Turn on “Allow paired devices to connect” above, and then create a one-time pairing link here.'
          : `Remote access is off on ${computer.name}: devices can pair once Coord there turns it on.`}</Text>
        : <form className="pairing-form" onSubmit={event => { event.preventDefault(); void createLink(); }}>
          {link && <Text emphasis="muted">That pairing link expired.</Text>}
          <TextField label="Device label (optional)" className="pairing-label" value={label} maxLength={80} onValueChange={setLabel} placeholder="e.g. Work laptop" spellCheck={false} autoComplete="off" disabled={busy || managed} />
          <fieldset className="pairing-permissions">
            <legend className="field-legend">Permissions</legend>
            {/* Always granted: a checked box that cannot be cleared, lined up with the one below. */}
            <Checkbox label="Use this computer" description="Work on its projects and create new ones. Every paired device can." checked disabled />
            <Checkbox label="Manage access" description="Create pairing links, and list and revoke paired devices."
              checked={manageAccess} disabled={busy || managed} onCheckedChange={value => setManageAccess(value === true)} />
          </fieldset>
          {chosen?.kind === 'lan' && <Alert tone="warning" className="access-warning">This link works over a local network, where the connection is not encrypted. Someone on that network who captures the device’s traffic could use {here ? 'this computer' : computer.name} as that device until you revoke it. Prefer Tailscale.</Alert>}
          <div className="row-actions">
            <Button type="submit" variant="primary" pending={busy} disabled={managed}>Create pairing link</Button>
          </div>
        </form>}
      </section>

      <section className="access-section" aria-label="Paired devices">
        <Text render={<h3 />} variant="body" className="settings-subheading">Paired devices</Text>
        {devices === null ? <Spinner label="Loading paired devices" /> : devices.length ? <List.Root className="device-list" aria-label="Paired devices">{devices.map(device => <List.Item key={device.deviceId}
          label={<span className="row-title"><strong>{device.name}</strong>{device.scopes.includes('access:manage') && <Badge tone="primary">Manage access</Badge>}{device.connected && <Badge tone="success">Connected</Badge>}</span>}
          description={`${platforms[device.platform] ?? device.platform} · paired ${absoluteDate(device.pairedAt)}${device.lastSeenAt && !device.connected ? ' · last seen ' + relativeDate(device.lastSeenAt) : ''}`}
          end={<ConfirmButton variant="outline" confirmLabel="Revoke access" disabled={managed} onConfirm={() => void revokeDevice(device.deviceId)}>Revoke…</ConfirmButton>} />)}
        </List.Root> : <Text emphasis="muted">No paired devices.</Text>}
      </section>
      {error && <Alert tone="danger" announce>{error}</Alert>}
    </>}
  </>;
}
