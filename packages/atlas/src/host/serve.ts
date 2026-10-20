// `atlas serve`: the host without the desktop app, so other computers can use this one's projects
// (a server, or a desktop left running). It listens on the Tailscale address unless told otherwise,
// prints a pairing link with a QR code, and in a terminal takes a few commands.
import { Worker } from 'node:worker_threads';
import { createInterface } from 'node:readline';
import QRCode from 'qrcode';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { prepareHome, readTemplates } from '../planning/index.ts';
import { hostAddresses } from './access/addresses.ts';
import { defaultPort, type PairingLink } from './contract.ts';
import { impostorHolder } from './access/access.ts';
import { Host } from './host.ts';
import type { WorkerLike } from './export/planWorkerClient.ts';
import { listenAddress } from './validate.ts';

export interface ServeOptions { address: string | null; port: number | null; home: string | null; version: string; interactive: boolean }
export interface ServeOutput { stdout(text: string): void; stderr(text: string): void }

/** Start serving; resolves with a stop function once the host listens, or throws a message for the user. */
export async function serve(options: ServeOptions, out: ServeOutput): Promise<{ stop(): Promise<void>; host: Host; link: PairingLink }> {
  const addresses = await hostAddresses();
  const address = options.address ?? addresses.find(entry => entry.kind === 'tailscale')?.address ?? null;
  if (!address) throw new Error('No Tailscale address found on this computer. Connect Tailscale, or give --address with an address of this computer (' + addresses.map(entry => entry.address).join(', ') + ').');
  try { listenAddress(address, '--address'); } catch (error) { throw new Error((error as Error).message + ' Give one address of this computer: ' + addresses.map(entry => entry.address).join(', ') + '.'); }
  const log = {
    info: (message: string) => { if (process.env.ATLAS_LOG_STDOUT === '1') out.stderr(message); },
    warn: (message: string, detail?: unknown) => out.stderr('Warning: ' + message + (detail && typeof detail === 'object' && 'message' in detail ? ': ' + String((detail as { message: unknown }).message) : '')),
    error: (message: string, detail?: unknown) => out.stderr('Error: ' + message + (detail instanceof Error ? ': ' + detail.message : '')),
  };
  const { home } = await prepareHome({ override: options.home ?? undefined });
  const host = new Host({
    home, version: options.version, log, owner: '`atlas serve`',
    createPlanWorker: () => new Worker(new URL('./export/planWorker.ts', import.meta.url)) as unknown as WorkerLike,
    networkOverride: { address, port: options.port ?? defaultPort },
    // The planning templates the atlas skill bundles, in this checkout.
    templates: () => readTemplates(path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../templates/planning')),
  });
  await host.start();
  if (host.access.managedBy !== null) {
    const { problem, managedBy: holder } = host.access;
    await host.stop();
    if (problem) throw new Error(problem);
    if (holder === impostorHolder) throw new Error('Another program holds the name of Atlas\'s remote access lock, so remote access stays off. Restarting the computer frees it.');
    throw new Error(`Remote access on this computer is managed by ${holder}. Use Remote Access… in the menu (☰) there, or quit it first.`);
  }
  const state = await host.accessState();
  if (!state.status.listening) { await host.stop(); throw new Error(state.status.error ?? 'Remote access could not start.'); }
  const listed = await host.projects();
  out.stdout(`Atlas host "${host.descriptor.name}" is serving this computer on http://${address.includes(':') ? '[' + address + ']' : address}:${state.status.port}.`);
  out.stdout(listed.length ? `It has ${listed.length} ${listed.length === 1 ? 'project' : 'projects'}:` : `It has no projects yet: they are the planning folders in ${path.join(home, 'planning')}.`);
  for (const project of listed.slice(0, 20)) out.stdout(`  ${project.name} (${project.path})${project.state === 'active' ? '' : ', ' + project.state}`);
  if (listed.length > 20) out.stdout(`  …and ${listed.length - 20} more.`);
  const link = await printLink(host, out, false);
  if (options.interactive) {
    out.stdout(commandHelp);
    const input = createInterface({ input: process.stdin });
    input.on('line', line => { void command(host, line.trim(), out).then(done => { if (done) { input.close(); void stop(); } }); });
  }
  let stopped = false;
  const stop = async () => {
    if (stopped) return;
    stopped = true;
    await host.stop();
    out.stdout('Atlas host stopped.');
  };
  return { stop, host, link };
}

const commandHelp = 'Press Enter for a new pairing link. Commands: manage (a pairing link that also grants Manage access), devices, revoke <device-id>, quit.';

/** A pairing link for one device: the whole computer, and Manage access (pair and revoke devices) when asked. */
async function printLink(host: Host, out: ServeOutput, manageAccess: boolean): Promise<PairingLink> {
  const status = host.networkStatus();
  const link = host.createPairing(status.address, { label: null, manageAccess });
  out.stdout('');
  out.stdout(await QRCode.toString(link.url!, { type: 'terminal', small: true, errorCorrectionLevel: 'M' }));
  out.stdout(`Pairing link (valid for 5 minutes, once${manageAccess ? '; grants Manage access' : ''}): ` + link.url);
  out.stdout('Code only: ' + link.code);
  out.stdout('In Atlas on the other computer, choose Connect to Another Atlas… in the menu (☰) and paste the link. The device can then use every project on this computer.');
  return link;
}

async function command(host: Host, line: string, out: ServeOutput): Promise<boolean> {
  try {
    if (line === '') { await printLink(host, out, false); return false; }
    if (line === 'manage') { await printLink(host, out, true); return false; }
    if (line === 'quit' || line === 'q' || line === 'exit') return true;
    if (line === 'devices') {
      const devices = host.devices();
      if (!devices.length) out.stdout('No paired devices.');
      for (const device of devices) out.stdout(`${device.deviceId}  ${device.name} (${device.platform}), paired ${device.pairedAt.slice(0, 10)}${device.scopes.includes('access:manage') ? ', manages access' : ''}${device.lastSeenAt ? ', last seen ' + device.lastSeenAt.slice(0, 16).replace('T', ' ') : ''}`);
      return false;
    }
    const revoke = /^revoke\s+(d-[a-f0-9]{32})$/.exec(line);
    if (revoke) { await host.revokeDevice(revoke[1]); out.stdout('Revoked ' + revoke[1] + '.'); return false; }
    out.stdout(commandHelp);
  } catch (error) { out.stderr((error as Error).message); }
  return false;
}
