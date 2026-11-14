// Coord's own updates: Settings › Updates, with the version running and its update, and the channel
// it follows (stable or nightly), and the title bar's update button, which shows only while a newer build
// is on offer, downloading or ready. Main checks on its own; downloading and restarting are the
// person's clicks.
import { useEffect, useId, useState, type ReactNode } from 'react';
import { Button, List, Progress, Select, Text, Tooltip } from '@envsemble/envui';
import type { UpdateChannel, UpdateState } from '../types';
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

/** The title bar's update button: Update (download it), its progress, then Restart to update. */
export function UpdateButton() {
  const state = useUpdates();
  const status = state?.status;
  if (status?.kind === 'available') {
    return <Tooltip content={`Coord ${status.version} is out`} side="bottom">
      <Button size="sm" variant="primary" startIcon={<UpdateIcon />} onClick={run(api.downloadUpdate)}>Update</Button>
    </Tooltip>;
  }
  if (status?.kind === 'downloading') {
    return <Button size="sm" variant="secondary" startIcon={<UpdateIcon />} pending aria-label={`Downloading Coord ${status.version}, ${status.percent}%`}>{status.percent}%</Button>;
  }
  if (status?.kind === 'ready') {
    return <Tooltip content={`Restart into Coord ${status.version}`} side="bottom">
      <Button size="sm" variant="primary" startIcon={<UpdateIcon />} onClick={run(api.installUpdate)}>Restart to update</Button>
    </Tooltip>;
  }
  return null;
}

const channels: { value: UpdateChannel; label: string; description: string }[] = [
  { value: 'stable', label: 'Stable', description: 'Releases, after they are tested. Recommended.' },
  { value: 'nightly', label: 'Nightly', description: 'A build of the newest changes, every night. It can break.' },
];

/**
 * Settings › Updates, as two setting rows: the version with where its update stands and the one
 * action that moves it on, and the channel, chosen at the row's end.
 */
export function UpdatesSection() {
  const id = useId();
  const state = useUpdates();
  if (!state) return null;
  const channel = channels.find(item => item.value === state.channel) ?? channels[0];
  const leavingNightly = state.channel === 'stable' && /-nightly\./.test(state.version);
  return <>
    <Text emphasis="muted" className="settings-description">
      Coord checks for a newer build of its channel when it starts and every few hours. It never downloads or installs one until you ask.
    </Text>
    <List.Root className="text-rows settings-rows" aria-label="Updates">
      <UpdateStatusRow state={state} />
      <List.Item className="settings-row" label={<span id={id + '-title'}>Channel</span>}
        description={<span id={id + '-detail'}>{leavingNightly ? 'This is a nightly build: Coord moves to stable with the next stable release newer than it, never back to an older one.' : channel.description}</span>}
        end={<Select className="settings-row-select" aria-labelledby={id + '-title'} aria-describedby={id + '-detail'} value={state.channel}
          onValueChange={value => { if (value) void api.setUpdateChannel(value as UpdateChannel).catch(() => {}); }}
          items={channels} />} />
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
      detail = `Coord ${status.version} is out.`;
      action = <Button variant="primary" startIcon={<UpdateIcon />} onClick={run(api.downloadUpdate)}>Download</Button>;
      break;
    case 'downloading':
      detail = <Progress className="updates-progress" label={`Downloading Coord ${status.version}`} value={status.percent} valueText={`${status.percent}%`} />;
      break;
    case 'ready':
      detail = `Coord ${status.version} is downloaded.`;
      action = <Button variant="primary" startIcon={<UpdateIcon />} onClick={run(api.installUpdate)}>Restart to update</Button>;
      break;
    case 'failed':
      detail = <span className="updates-failure">{status.message}</span>;
      action = checkButton('Try again');
      break;
  }
  return <List.Item className="settings-row updates-status" label={`Coord ${state.version}`}
    description={<span role="status">{detail}</span>} end={action} />;
}
