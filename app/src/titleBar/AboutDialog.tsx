// About Coord, from the menu in every window: the version, what stays on this computer, the versions and the
// Coord home, and the details a bug report needs, copied in one step.
import { useEffect, useState } from 'react';
import { Button, Dialog, Text } from '@envsemble/envui';
import { CoordMark } from '@envsemble/coord-diagrams/mark';
import type { AboutInfo } from '../../shared/contract';
import { api, CoordError } from '../api';
import { FolderOpenIcon } from '../ui/icons';
import { CopyButton } from '../ui/CopyButton';

export function AboutDialog({ onClose, onError }: { onClose(): void; onError(message: string): void }) {
  const [about, setAbout] = useState<AboutInfo | null>(null);
  useEffect(() => {
    let current = true;
    api.about().then(next => { if (current) setAbout(next); }, error => { if (current) { onError((error as Error).message); onClose(); } });
    return () => { current = false; };
  }, []);
  // The dialog opens once it has its facts, a moment later, so nothing moves as they arrive.
  if (!about) return null;
  const versions: [string, string][] = [['Electron', about.electron], ['Chromium', about.chromium], ['Node.js', about.node], ['System', about.system]];
  const details = ['Coord ' + about.version, ...versions.map(([name, value]) => name + ' ' + value)].join('\n');
  const openLogs = () => { api.command('openLogs').catch(error => { if ((error as CoordError).code !== 'cancelled') onError((error as Error).message); }); };
  return <Dialog open onOpenChange={open => { if (!open) onClose(); }} className="about-dialog"
    title={<span className="about-dialog-title"><CoordMark size={40} label="" />Coord</span>} description={'Version ' + about.version}
    actions={<>
      <Button variant="secondary" start={<FolderOpenIcon />} onClick={openLogs}>Open Logs</Button>
      <CopyButton text={details} label="Copy Details" />
    </>}>
    <Text>Plans, models and shared understanding for agents and the people they work with.</Text>
    <Text variant="body-sm" emphasis="muted">Coord works offline. Plans, diagrams, statistics and logs stay on this computer, unless you turn on remote access (in Settings › Computers) so your paired devices can use its projects.</Text>
    <dl className="facts about-dialog-facts">
      {versions.map(([name, value]) => <div key={name}><dt>{name}</dt><dd>{value}</dd></div>)}
      <div><dt>Coord home</dt><dd><bdi>{about.dataFolder}</bdi></dd></div>
    </dl>
  </Dialog>;
}
