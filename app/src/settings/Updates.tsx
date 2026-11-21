// Coord's own updates: Settings › Updates, with the version running and its update, and the channel
// it follows (stable or nightly), and the title bar's update button, which shows only while a newer build
// is on offer, downloading or ready. Main checks on its own; downloading and restarting are the
// person's clicks.
import { useEffect, useId, useState, type MouseEvent, type ReactElement, type ReactNode } from 'react';
import { Button, Column, HoverCard, Link, List, RelativeTime, Select, Spinner, Surface, Text } from '@envsemble/envui';
import type { UpdateChange, UpdateChannel, UpdateState, UpdateStatus } from '../types';
import { api } from '../api';
import { relativeDate } from '../ui/format';
import { NewWindowIcon, UpdateIcon } from '../ui/icons';
import { isNightlyVersion, releasePage, releaseRepository } from '../../shared/contract';

/** Coord's update as main reports it, kept current; null until it answers. */
export function useUpdates() {
  const [state, setState] = useState<UpdateState | null>(null);
  useEffect(() => {
    let live = true;
    const stop = api.onUpdatesChanged(next => setState(next));
    api.updates().then(value => { if (live) setState(current => current ?? value); }, () => {});
    return () => { live = false; stop(); };
  }, []);
  return state;
}

/** Run an update action; a refused one shows in the section's status as main reports it. */
const run = (action: () => Promise<unknown>) => () => { void action().catch(() => {}); };

/** The title bar's update button: Update (download it), its progress, then Restart to update. Hovering it shows what the update changes. */
export function UpdateButton() {
  const state = useUpdates();
  const status = state?.status;
  if (!state || !status) return null;
  let button: ReactElement;
  if (status.kind === 'available') {
    button = <Button size="sm" variant="primary" start={<UpdateIcon />} onClick={run(api.downloadUpdate)}>Update</Button>;
  } else if (status.kind === 'downloading') {
    // The percentage is the download's progress; the button keeps one width as the number grows.
    button = <Button size="sm" variant="secondary" start={<UpdateIcon />} className="update-progress-button"
      aria-label={`Downloading Coord ${status.version}, ${status.percent}%`}>{status.percent}%</Button>;
  } else if (status.kind === 'ready') {
    button = <Button size="sm" variant="primary" start={<UpdateIcon />} onClick={run(api.installUpdate)}>Restart to update</Button>;
  } else return null;
  return <HoverCard trigger={button} side="bottom" align="center" width="lg">
    <UpdateCard status={status} state={state} />
  </HoverCard>;
}

/** How many of an update's changes the card lists; the comparison on GitHub has them all. */
const listed = 6;

const headings = { available: 'Update ready to download', downloading: 'Downloading the update', ready: 'Ready to restart' };
const notes = {
  available: 'It downloads in the background. Nothing changes until you restart.',
  downloading: 'You can keep working. Nothing changes until you restart.',
  ready: 'Restart Coord to finish. Your windows open again as they were.',
};
/** A release's own commit ("Release 0.10.0: …"), which says nothing the version line does not. */
const bookkeeping = (change: UpdateChange) => change.pull === null && /^Release v?\d+\.\d+\.\d+\b/.test(change.title);

/**
 * The update, then what it brings: the update's state, version and age at the top; its changes since
 * the running build in a well of their own below; and the comparison on GitHub.
 */
function UpdateCard({ status, state }: { status: Extract<UpdateStatus, { version: string }>; state: UpdateState }) {
  const changesHeading = useId();
  const { changes } = state;
  const all = changes?.changes.filter(change => !bookkeeping(change)) ?? [];
  const shown = all.slice(0, listed);
  const repository = `https://github.com/${releaseRepository}`;
  const open = (event: MouseEvent<HTMLAnchorElement>) => { event.preventDefault(); void api.openExternal(event.currentTarget.href).catch(() => {}); };
  const external = (href: string, label: string) => <Link href={href} onClick={open} className="update-card-link">{label}<NewWindowIcon aria-hidden="true" /></Link>;
  return <Column gap={4} className="update-card">
    <Column gap={1} render={<header />}>
      <div className="update-card-heading">
        <Text variant="title" tabularNumbers render={<h2 />}>{headings[status.kind]}{status.kind === 'downloading' && ` · ${status.percent}%`}</Text>
      </div>
      <Text variant="body-sm">
        <Text variant="body-sm" emphasis="default" render={<span />}>Coord {status.version}</Text>{!isNightlyVersion(status.version) && ' · Stable'}
        {status.released && <> · released <RelativeTime value={status.released} /></>}
      </Text>
      <Text variant="body-sm" emphasis={status.kind === 'ready' ? 'default' : undefined}>{notes[status.kind]}</Text>
    </Column>
    <Surface background="muted" padding={3} radius="sm" className="update-card-changes" render={<section aria-labelledby={changesHeading} />}>
      <Column gap={3}>
        <div className="update-card-caption">
          <Text variant="body-sm" emphasis="default" render={<h3 id={changesHeading} />}>What's new</Text>
          {shown.length > 0 && <Text variant="caption" render={<span />}>since {state.version}</Text>}
        </div>
        {changes && changes.commits !== null && (shown.length > 0 ? <ul className="update-changes">
          {shown.map(change => <li key={change.sha}>
            <Text variant="body-sm" emphasis="default" render={<span className="update-change-title" />}>{change.title}</Text>
            <Text variant="body-sm" tabularNumbers render={<span />}>
              <Link className="update-change-ref" href={change.pull ? `${repository}/pull/${change.pull}` : `${repository}/commit/${change.sha}`} onClick={open}
                aria-label={change.pull ? `Pull request ${change.pull}` : `Commit ${change.sha.slice(0, 7)}`}>
                {change.pull ? `#${change.pull}` : change.sha.slice(0, 7)}
              </Link>
            </Text>
          </li>)}
        </ul> : <Text variant="body-sm">No changes to show.</Text>)}
        {changes?.commits === null && <Column gap={1}>
          <Text variant="body-sm">A comparison with your version isn't available.</Text>
          <Text variant="body-sm">{external(changes.url, 'Release notes on GitHub')}</Text>
        </Column>}
        {!changes && state.changesLoading && <div className="update-card-loading"><Spinner size="sm" /><Text variant="body-sm" render={<span />}>Loading…</Text></div>}
        {!changes && !state.changesLoading && <Column gap={1}>
          <Text variant="body-sm">Couldn't load the changes.</Text>
          <Text variant="body-sm">{external(releasePage(status.version), 'Release notes on GitHub')}</Text>
        </Column>}
      </Column>
    </Surface>
    {changes && changes.commits !== null && <div className="update-card-caption">
      <Text variant="body-sm" render={<span />}>{external(changes.url, 'Full comparison on GitHub')}</Text>
      {shown.length > 0 && (changes.partial || all.length > shown.length) && <Text variant="caption" tabularNumbers render={<span />}>{changes.partial ? `Showing ${shown.length} changes` : `${shown.length} of ${all.length} changes`}</Text>}
    </div>}
  </Column>;
}

/**
 * The update's changes on GitHub: the comparison with the running build, or the update's release when
 * there is no comparison or GitHub did not answer; nothing while it is asked.
 */
function ChangesLink({ state, version }: { state: UpdateState; version: string }) {
  const { changes } = state;
  if (!changes && state.changesLoading) return null;
  const url = changes?.url ?? releasePage(version);
  const label = !changes || changes.commits === null ? 'Release notes on GitHub' : 'Full comparison on GitHub';
  return <Link href={url} onClick={event => { event.preventDefault(); void api.openExternal(url).catch(() => {}); }}>{label}</Link>;
}

const channels: { value: UpdateChannel; label: string; description: string }[] = [
  { value: 'stable', label: 'Stable', description: 'Releases, after they are tested. Recommended.' },
  { value: 'nightly', label: 'Nightly', description: 'A build of the newest changes, every six hours. It can break.' },
];

/**
 * Settings › Updates, as two setting rows: the version with where its update stands and the one
 * action that moves it on, and the channel, chosen at the row's end.
 */
export function UpdatesSection() {
  const state = useUpdates();
  if (!state) return null;
  const channel = channels.find(item => item.value === state.channel) ?? channels[0];
  const leavingNightly = state.channel === 'stable' && /-nightly\./.test(state.version);
  // A build that cannot update itself (in development, say) shows only why; the checks and the
  // channel apply where Coord updates itself.
  const off = state.status.kind === 'off';
  return <>
    {!off && <Text variant="body-sm" emphasis="muted" className="settings-description">
      Coord checks for a newer build of its channel when it starts and every few hours. It never downloads or installs one until you ask.
    </Text>}
    <List.Root className="settings-rows" aria-label="Updates">
      <UpdateStatusRow state={state} />
      {!off && <List.Item className="settings-row" label="Channel"
        description={leavingNightly ? 'This is a nightly build: Coord moves to stable with the next stable release newer than it, never back to an older one.' : channel.description}
        control={<Select className="settings-row-select" value={state.channel}
            onValueChange={value => { if (value) void api.setUpdateChannel(value as UpdateChannel).catch(() => {}); }}
            items={channels} />} />}
    </List.Root>
  </>;
}

/** The version, where its update stands, and the one action that moves it on. */
function UpdateStatusRow({ state }: { state: UpdateState }) {
  const { status } = state;
  const checkButton = (label: string) => <Button variant="secondary" pending={status.kind === 'checking'} onClick={run(api.checkForUpdates)}>{label}</Button>;
  let detail: ReactNode = null, action: ReactNode = null;
  switch (status.kind) {
    case 'off': detail = status.reason; break;
    case 'idle':
      detail = status.checkedAt ? `Up to date. Checked ${relativeDate(status.checkedAt)}.` : 'Not checked yet.';
      action = checkButton('Check now');
      break;
    case 'checking': detail = 'Checking…'; action = checkButton('Check now'); break;
    case 'available':
      detail = <>Coord {status.version} is out.{' '}<ChangesLink state={state} version={status.version} /></>;
      action = <Button variant="primary" start={<UpdateIcon />} onClick={run(api.downloadUpdate)}>Download</Button>;
      break;
    case 'downloading':
      detail = <>Downloading Coord {status.version} · <span className="updates-percent">{status.percent}%</span><span className="updates-changes-line"><ChangesLink state={state} version={status.version} /></span></>;
      break;
    case 'ready':
      detail = <>Coord {status.version} is downloaded.{' '}<ChangesLink state={state} version={status.version} /></>;
      action = <Button variant="primary" start={<UpdateIcon />} onClick={run(api.installUpdate)}>Restart to update</Button>;
      break;
    case 'failed':
      detail = <span className="updates-failure">{status.message}</span>;
      action = checkButton('Try again');
      break;
  }
  return <List.Item className="settings-row updates-status" label={`Coord ${state.version}`}
    description={<span role="status">{detail}</span>} end={action} />;
}
