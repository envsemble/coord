// Coord's own updates: Settings › Updates, with the version running and its update, and the channel
// it follows (stable or nightly), and the title bar's update button, which shows only while a newer build
// is on offer, downloading or ready. Main checks on its own; downloading and restarting are the
// person's clicks.
import { useEffect, useState, type ReactElement, type ReactNode } from 'react';
import { Button, Column, HoverCard, Link, List, Progress, Select, Text } from '@envsemble/envui';
import type { UpdateChanges, UpdateChannel, UpdateState } from '../types';
import { api } from '../api';
import { relativeDate } from '../ui/format';
import { UpdateIcon } from '../ui/icons';

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
  let button: ReactElement, lead: string;
  if (status.kind === 'available') {
    button = <Button size="sm" variant="primary" start={<UpdateIcon />} onClick={run(api.downloadUpdate)}>Update</Button>;
    lead = 'Out now. Update downloads it; nothing changes until you restart.';
  } else if (status.kind === 'downloading') {
    button = <Button size="sm" variant="secondary" start={<UpdateIcon />} pending aria-label={`Downloading Coord ${status.version}, ${status.percent}%`}>{status.percent}%</Button>;
    lead = `Downloading, ${status.percent}%.`;
  } else if (status.kind === 'ready') {
    button = <Button size="sm" variant="primary" start={<UpdateIcon />} onClick={run(api.installUpdate)}>Restart to update</Button>;
    lead = 'Downloaded. Restart to update.';
  } else return null;
  return <HoverCard trigger={button} side="bottom" align="start" width="lg">
    <UpdateChangesCard version={status.version} lead={lead} state={state} />
  </HoverCard>;
}

/** How many of an update's changes the card lists; the comparison on GitHub has them all. */
const listed = 8;

/** The update's version, where it stands, and what it changes since the running build. */
function UpdateChangesCard({ version, lead, state }: { version: string; lead: string; state: UpdateState }) {
  const { changes } = state;
  const shown = changes?.changes.slice(0, listed) ?? [];
  return <Column gap={3}>
    <Column gap={1}>
      <Text variant="title" render={<strong />}>Coord {version}</Text>
      <Text variant="body-sm">{lead}</Text>
    </Column>
    {shown.length > 0 && <ul className="update-changes" aria-label="What changed">
      {shown.map(change => <li key={change.sha}>
        <Text variant="body-sm" emphasis="default" render={<span />}>{change.title}</Text>
        {' '}<Text variant="caption" emphasis="subtle" render={<span />}>{change.pull ? `#${change.pull}` : change.sha.slice(0, 7)}</Text>
      </li>)}
    </ul>}
    {changes && <Text variant="caption"><ChangesLink changes={changes} since={state.version} /></Text>}
  </Column>;
}

/** The update's changes on GitHub: the comparison with the running build, or the update's release. */
function ChangesLink({ changes, since }: { changes: UpdateChanges; since: string }) {
  const label = changes.commits === null ? 'Release notes on GitHub' : `${changes.commits === 1 ? '1 commit' : `${changes.commits} commits`} since ${since}`;
  return <Link href={changes.url} onClick={event => { event.preventDefault(); void api.openExternal(changes.url).catch(() => {}); }}>{label}</Link>;
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
      detail = <>Coord {status.version} is out.{state.changes && <> <ChangesLink changes={state.changes} since={state.version} /></>}</>;
      action = <Button variant="primary" start={<UpdateIcon />} onClick={run(api.downloadUpdate)}>Download</Button>;
      break;
    case 'downloading':
      detail = <>
        <Progress className="updates-progress" label={`Downloading Coord ${status.version}`} value={status.percent} valueText={`${status.percent}%`} />
        {state.changes && <ChangesLink changes={state.changes} since={state.version} />}
      </>;
      break;
    case 'ready':
      detail = <>Coord {status.version} is downloaded.{state.changes && <> <ChangesLink changes={state.changes} since={state.version} /></>}</>;
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
