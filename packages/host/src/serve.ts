// `atlas serve`: the host without the desktop app, for a computer that only shares its planning
// folders (a server, or a desktop left running). It listens on the Tailscale address unless told
// otherwise, prints a pairing link with a QR code, and in a terminal takes a few commands.
import { Worker } from 'node:worker_threads';
import { createInterface } from 'node:readline';
import QRCode from 'qrcode';
import { atlasDataDirectory } from '@envsemble/atlas-planning';
import { hostAddresses } from './addresses.ts';
import { defaultPort, type PairingLink } from './contract.ts';
import { Host } from './host.ts';
import type { WorkerLike } from './planWorkerClient.ts';

export interface ServeOptions { folders: string[]; address: string | null; port: number | null; dataDir: string | null; version: string; interactive: boolean }
export interface ServeOutput { stdout(text: string): void; stderr(text: string): void }

/** Start serving; resolves with a stop function once the host listens, or throws a message for the user. */
export async function serve(options: ServeOptions, out: ServeOutput): Promise<{ stop(): Promise<void>; host: Host; link: PairingLink }> {
  const addresses = await hostAddresses();
  const address = options.address ?? addresses.find(entry => entry.kind === 'tailscale')?.address ?? null;
  if (!address) throw new Error('No Tailscale address found on this computer. Connect Tailscale, or give --address with an address of this computer (' + addresses.map(entry => entry.address).join(', ') + ').');
  const log = {
    info: (message: string) => { if (process.env.ATLAS_LOG_STDOUT === '1') out.stderr(message); },
    warn: (message: string, detail?: unknown) => out.stderr('Warning: ' + message + (detail && typeof detail === 'object' && 'message' in detail ? ': ' + String((detail as { message: unknown }).message) : '')),
    error: (message: string, detail?: unknown) => out.stderr('Error: ' + message + (detail instanceof Error ? ': ' + detail.message : '')),
  };
  const host = new Host({
    dataDirectory: atlasDataDirectory(options.dataDir ?? undefined), version: options.version, log, owner: '`atlas serve`',
    createPlanWorker: () => new Worker(new URL('./planWorker.ts', import.meta.url)) as unknown as WorkerLike,
    extraShared: options.folders, networkOverride: { address, port: options.port ?? defaultPort },
  });
  if (host.access.managedBy) {
    host.access.unlock();
    throw new Error(`Remote access on this computer is managed by ${host.access.managedBy}. Use File › Remote Access… there, or quit it first.`);
  }
  await host.start();
  const state = await host.accessState();
  if (!state.status.listening) { await host.stop(); throw new Error(state.status.error ?? 'Remote access could not start.'); }
  const shared = state.settings.sharedFolders;
  out.stdout(`Atlas host "${host.descriptor.name}" is serving ${shared.length} planning ${shared.length === 1 ? 'folder' : 'folders'} on http://${address.includes(':') ? '[' + address + ']' : address}:${state.status.port}.`);
  for (const folder of shared) out.stdout('  ' + folder);
  if (!shared.length) out.stdout('  No folders are shared. Give --folder <planning-root>, or share folders in the Atlas app.');
  const link = await printLink(host, out);
  if (options.interactive) {
    out.stdout('Press Enter for a new pairing link. Commands: devices, revoke <device-id>, quit.');
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

async function printLink(host: Host, out: ServeOutput) {
  const status = host.networkStatus();
  const pairing = host.access.createPairing(status.address);
  const url = `http://${status.address!.includes(':') ? '[' + status.address + ']' : status.address}:${status.port}/pair#token=${pairing.code}`;
  out.stdout('');
  out.stdout(await QRCode.toString(url, { type: 'terminal', small: true, errorCorrectionLevel: 'M' }));
  out.stdout('Pairing link (valid for 5 minutes, once): ' + url);
  out.stdout('Code only: ' + pairing.code);
  out.stdout('In Atlas on the other computer, choose File › Connect to Another Atlas… and paste the link.');
  return { code: pairing.code, expiresAt: new Date(pairing.expiresAt).toISOString(), url, address: status.address, port: status.port };
}

async function command(host: Host, line: string, out: ServeOutput): Promise<boolean> {
  try {
    if (line === '') { await printLink(host, out); return false; }
    if (line === 'quit' || line === 'q' || line === 'exit') return true;
    if (line === 'devices') {
      const devices = host.devices();
      if (!devices.length) out.stdout('No paired devices.');
      for (const device of devices) out.stdout(`${device.deviceId}  ${device.name} (${device.platform}), paired ${device.pairedAt.slice(0, 10)}${device.lastSeenAt ? ', last seen ' + device.lastSeenAt.slice(0, 16).replace('T', ' ') : ''}`);
      return false;
    }
    const revoke = /^revoke\s+(d-[a-f0-9]{32})$/.exec(line);
    if (revoke) { await host.revokeDevice(revoke[1]); out.stdout('Revoked ' + revoke[1] + '.'); return false; }
    out.stdout('Commands: Enter (new pairing link), devices, revoke <device-id>, quit.');
  } catch (error) { out.stderr((error as Error).message); }
  return false;
}
