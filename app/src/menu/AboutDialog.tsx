// About Atlas, from the menu in every window: the version, what stays on this computer, the versions and the
// Atlas home, and the details a bug report needs, copied in one step.
import { useEffect, useState } from 'react';
import { Button, Dialog, Text } from '@envsemble/envui';
import { AtlasMark } from '@envsemble/atlas-diagrams/mark';
import type { AboutInfo } from '../../shared/contract';
import { api, AtlasError } from '../api';
import { FolderOpenIcon } from '../ui/icons';
import { CopyButton } from '../ui/ui';

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
  const details = ['Atlas ' + about.version, ...versions.map(([name, value]) => name + ' ' + value)].join('\n');
  const openLogs = () => { api.command('openLogs').catch(error => { if ((error as AtlasError).code !== 'cancelled') onError((error as Error).message); }); };
  return <Dialog open onOpenChange={open => { if (!open) onClose(); }} className="about-dialog"
    title={<span className="about-dialog-title"><AtlasMark size={40} label="" />Atlas</span>} description={'Version ' + about.version}
    actions={<>
      <Button variant="secondary" startIcon={<FolderOpenIcon />} onClick={openLogs}>Open Logs</Button>
      <CopyButton text={details} label="Copy Details" />
    </>}>
    <Text>Plans, models and shared understanding for agents and the people they work with.</Text>
    <Text variant="supporting" tone="muted">Atlas works offline. Plans, models, statistics and logs stay on this computer, unless you turn on remote access (Remote Access…, in the menu) so your paired devices can use its projects.</Text>
    <dl className="facts about-dialog-facts">
      {versions.map(([name, value]) => <div key={name}><dt>{name}</dt><dd>{value}</dd></div>)}
      <div><dt>Atlas home</dt><dd><bdi>{about.dataFolder}</bdi></dd></div>
    </dl>
  </Dialog>;
}
