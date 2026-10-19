// The Atlas host and its client. The desktop app runs the host in a utility process and connects
// to it as the owner; `atlas serve` runs it without the app; paired devices connect as clients.
export { Host, acceptableHost, type HostOptions } from './host.ts';
export { AccessStore, newPairingCode, normalizeCode } from './access/access.ts';
export { hostAddresses, inSharedRange, isPrivate } from './access/addresses.ts';
export { HostClient, HostRequestError, describeHost, pairWithHost, parsePairing, type ClientOptions, type ClientStatus } from './client.ts';
export { FolderRegistry, folderIdOf, pathKey } from './folders/folders.ts';
export { HostError, toErrorValue, type Logger } from './errors.ts';
export { PlanWorkerClient, type WorkerLike } from './export/planWorkerClient.ts';
export { exportFileName } from './export/planExportName.ts';
export type * from './contract.ts';
export { closeCodes, defaultPort, methodScopes, pairingLifetime, pairingUrl, protocolVersion, routes } from './contract.ts';
