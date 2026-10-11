// What a window shows: one planning folder on a host, this computer's own or another one's. The
// window's requests go through the host connection; its state follows the host's folder events and
// the connection's status. The revision counts up here, in main, so a host that restarted (and
// counts from zero again) never makes the window ignore fresh data.
import type { ClientStatus, FolderState, HostClient } from '@envsemble/atlas-host';
import type { FolderChange, FolderStatus } from '../shared/contract.ts';

export interface FolderLocation {
  client: HostClient;
  folderId: string;
  /** The folder's path on this computer, or `atlas-remote:<host>/<folder>` for another computer's. */
  root: string;
  name: string;
  remote: { hostId: string; hostName: string } | null;
}

/** The key a remote folder is remembered under (window restore, tabs and sidebar). */
export function remoteRoot(hostId: string, folderId: string) { return `atlas-remote:${hostId}/${folderId}`; }
export function parseRemoteRoot(root: string) {
  const match = /^atlas-remote:([a-zA-Z0-9-]{8,64})\/(f-[a-f0-9]{32})$/.exec(root);
  return match ? { hostId: match[1], folderId: match[2] } : null;
}

export class FolderView {
  readonly client: HostClient;
  readonly folderId: string;
  readonly root: string;
  name: string;
  readonly remote: FolderLocation['remote'];
  status: FolderStatus;
  error: string | null;
  private hostNotice: string | null;
  private connectionNotice: string | null = null;
  revision = 0;
  private closed = false;

  constructor(location: FolderLocation, state: FolderState) {
    this.client = location.client;
    this.folderId = location.folderId;
    this.root = location.root;
    this.name = location.name || state.name;
    this.remote = location.remote;
    this.status = state.status;
    this.error = state.error;
    this.hostNotice = state.notice;
  }

  get readOnly() { return this.remote !== null; }
  get notice() { return this.connectionNotice ?? this.hostNotice; }
  change(): FolderChange { return { revision: this.revision, status: this.status, error: this.error, notice: this.notice }; }

  /** A folder event from the host. */
  update(state: FolderState) {
    if (state.name) this.name = state.name;
    this.status = state.status;
    this.error = state.error;
    this.hostNotice = state.notice;
    this.revision++;
  }
  /** The connection's status: an unreachable host keeps the last good view with a notice; a refused one closes it. */
  connection(status: ClientStatus, detail: string | null) {
    if (status === 'connected') this.connectionNotice = null;
    else if (status === 'connecting' || status === 'offline') this.connectionNotice = (detail ?? 'Reconnecting to the host…') + (this.status === 'ready' ? ' Showing the last view.' : '');
    else if (status === 'revoked' || status === 'mismatch' || status === 'incompatible') {
      this.status = 'invalid';
      this.error = detail ?? 'The host refused the connection.';
      this.connectionNotice = null;
    }
    this.revision++;
  }

  request: HostClient['request'] = (method, params, options) => this.client.request(method, params, options);
  /** A file inside the folder (images and attachments in documents), over the host's authenticated HTTP. */
  file(relative: string) {
    return this.client.fetch(`/api/folders/${this.folderId}/files/` + relative.split('/').map(encodeURIComponent).join('/'));
  }

  close() {
    if (this.closed) return;
    this.closed = true;
    void this.client.unfollow(this.folderId);
  }
}
