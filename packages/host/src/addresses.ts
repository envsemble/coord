// The addresses this computer can be reached on: itself, its local networks, and its Tailscale
// address. Tailscale shares the 100.64.0.0/10 range with other VPNs, so an address there counts
// as Tailscale only when its interface is Tailscale's or `tailscale ip` reports it.
import { execFile } from 'node:child_process';
import { networkInterfaces } from 'node:os';
import { promisify } from 'node:util';
import type { HostAddress } from './contract.ts';

const execute = promisify(execFile);

function octets(address: string) { return address.split('.').map(Number); }
/** 100.64.0.0/10, the carrier-grade NAT range Tailscale assigns from. */
export function inSharedRange(address: string) {
  const [a, b] = octets(address);
  return a === 100 && b >= 64 && b <= 127;
}
/** RFC 1918 private ranges. Link-local (169.254/16) addresses are not offered. */
export function isPrivate(address: string) {
  const [a, b] = octets(address);
  return a === 10 || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168);
}

async function tailscaleReported(): Promise<Set<string>> {
  try {
    const { stdout } = await execute('tailscale', ['ip', '-4'], { timeout: 1500, windowsHide: true });
    return new Set(stdout.split(/\s+/).filter(Boolean));
  } catch { return new Set(); }
}

export interface InterfaceAddress { name: string; address: string; family: string; internal: boolean }
export function interfaceAddresses(): InterfaceAddress[] {
  return Object.entries(networkInterfaces()).flatMap(([name, entries]) => (entries ?? []).map(entry => ({ name, address: entry.address, family: String(entry.family), internal: entry.internal })));
}

/** Every address remote access can listen on, best first: Tailscale, then local networks, then this machine. */
export async function hostAddresses(found: InterfaceAddress[] = interfaceAddresses(), reported?: Set<string>): Promise<HostAddress[]> {
  const result: HostAddress[] = [];
  const shared = found.filter(entry => entry.family === 'IPv4' && !entry.internal && inSharedRange(entry.address));
  const confirmed = shared.length && !reported && shared.some(entry => !/tailscale/i.test(entry.name)) ? await tailscaleReported() : reported ?? new Set<string>();
  for (const entry of found) {
    if (entry.family !== 'IPv4' || entry.internal) continue;
    if (inSharedRange(entry.address)) {
      if (/tailscale/i.test(entry.name) || confirmed.has(entry.address)) result.push({ address: entry.address, kind: 'tailscale', label: 'Tailscale' });
      else result.push({ address: entry.address, kind: 'lan', label: 'VPN or other network (' + entry.name + ')' });
    } else if (isPrivate(entry.address)) result.push({ address: entry.address, kind: 'lan', label: 'Local network (' + entry.name + ')' });
  }
  const order = { tailscale: 0, lan: 1, loopback: 2 } as const;
  result.sort((a, b) => order[a.kind] - order[b.kind] || a.address.localeCompare(b.address, undefined, { numeric: true }));
  result.push({ address: '127.0.0.1', kind: 'loopback', label: 'This machine' });
  return result.filter((entry, index) => result.findIndex(other => other.address === entry.address) === index);
}
