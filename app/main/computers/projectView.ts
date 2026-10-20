// A project as a window follows it, on a host: this computer's own or another one's. The window's
// requests about it go through the host connection; its state follows the host's project.changed
// events and the connection's status. The revision counts up here, in main, so a host that restarted
// (and counts from zero again) never makes the window ignore fresh data.
import type { ClientStatus, HostClient, OpenProjectState } from '@envsemble/atlas/host';
import type { OpenProjectChange, ProjectStatus } from '../../shared/contract.ts';

export class ProjectView {
  readonly client: HostClient;
  readonly projectId: string;
  /** Set when the project is on another computer. */
  readonly remote: { hostId: string; hostName: string } | null;
  status: ProjectStatus = 'loading';
  error: string | null = null;
  private hostNotice: string | null = null;
  private connectionNotice: string | null = null;
  revision = 0;
  /** The revision at which the host last read the project's files; see OpenProjectChange. */
  files = 0;
  /** The host's own count of its reads of the files, as last told; null when the next state may come from a host that restarted. */
  private hostFiles: number | null = null;
  private closed = false;

  constructor(client: HostClient, projectId: string, remote: ProjectView['remote'], revision = 0) {
    this.client = client;
    this.projectId = projectId;
    this.remote = remote;
    this.revision = revision;
    this.files = revision;
  }

  get notice() { return this.connectionNotice ?? this.hostNotice; }
  change(): OpenProjectChange { return { revision: this.revision, files: this.files, status: this.status, error: this.error, notice: this.notice }; }

  /** A project.changed event from the host, or the project's state when the window started following it. */
  update(state: OpenProjectState) {
    this.status = state.status;
    this.error = state.error;
    this.hostNotice = state.notice;
    this.revision++;
    if (state.files !== this.hostFiles) { this.hostFiles = state.files; this.files = this.revision; }
  }
  /** It could not be followed: unreadable here until its computer answers again. */
  failed(message: string) {
    this.status = 'invalid';
    this.error = message;
    this.files = ++this.revision;
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
    // A host that comes back may have restarted, or missed nothing: its next state says.
    if (status !== 'connected') this.hostFiles = null;
    this.files = ++this.revision;
  }

  request: HostClient['request'] = (method, params, options) => this.client.request(method, params, options);
  /** A file inside the project's planning folder (images and attachments in documents), over the host's authenticated HTTP. */
  file(relative: string) {
    return this.client.fetch(`/api/projects/${this.projectId}/files/` + relative.split('/').map(encodeURIComponent).join('/'));
  }

  close() {
    if (this.closed) return;
    this.closed = true;
    void this.client.unfollow(this.projectId);
  }
}
