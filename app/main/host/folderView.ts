// A project's folder as a window follows it, on a host: this computer's own or another one's. The
// window's requests about it go through the host connection; its state follows the host's folder
// events and the connection's status. The revision counts up here, in main, so a host that restarted
// (and counts from zero again) never makes the window ignore fresh data.
import type { ClientStatus, FolderState, HostClient } from '@envsemble/atlas/host';
import type { FolderChange, FolderStatus } from '../../shared/contract.ts';

export class FolderView {
  readonly client: HostClient;
  readonly folderId: string;
  /** Set when the project is on another computer. */
  readonly remote: { hostId: string; hostName: string } | null;
  status: FolderStatus = 'loading';
  error: string | null = null;
  private hostNotice: string | null = null;
  private connectionNotice: string | null = null;
  revision = 0;
  private closed = false;

  constructor(client: HostClient, folderId: string, remote: FolderView['remote'], revision = 0) {
    this.client = client;
    this.folderId = folderId;
    this.remote = remote;
    this.revision = revision;
  }

  get notice() { return this.connectionNotice ?? this.hostNotice; }
  change(): FolderChange { return { revision: this.revision, status: this.status, error: this.error, notice: this.notice }; }

  /** A folder event from the host, or its state when the window started following it. */
  update(state: FolderState) {
    this.status = state.status;
    this.error = state.error;
    this.hostNotice = state.notice;
    this.revision++;
  }
  /** It could not be followed: unreadable here until its computer answers again. */
  failed(message: string) {
    this.status = 'invalid';
    this.error = message;
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
