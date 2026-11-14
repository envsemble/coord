// What the app imports of the Coord host and its client. The desktop app runs the host in a utility
// process and connects to it as the owner; `coord serve` runs it without the app; paired devices
// connect as clients. The protocol's constants are in `@envsemble/coord/host/contract`.
export { Host } from './host.ts';
export { HostClient, HostRequestError, describeHost, pairWithHost, parsePairing, type ClientStatus } from './client.ts';
export type * from './contract.ts';
