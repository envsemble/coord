// The badge beside the title bar's logo for a build that is not a stable release: Coord Dev's Dev,
// which is also its menu (copy the real data again, remove the dev plugin; main/dev.ts), and a
// nightly build's Nightly.
import { Badge, Button, Menu } from '@envsemble/envui';
import { isNightlyVersion, type AppCommand } from '../../shared/contract';
import type { WindowInfo } from '../types';

/** Beside the logo, a build that is not a stable release says so: Coord Dev (on a copy of the data) as Dev, a nightly build as Nightly. */
export function BuildBadge({ info, run }: { info: Pick<WindowInfo, 'dev' | 'version'>; run(command: AppCommand): void }) {
  if (info.dev) return <Menu.Root aria-label="Coord Dev" align="start"
    // The tag opens the menu: a quiet button holding the Dev badge, which keeps its own look (coord.css).
    trigger={<Button variant="ghost" size="sm" className="build-badge-button" aria-label="Coord Dev"><Badge tone="warning">Dev</Badge></Button>}>
    <Menu.Item onClick={() => run('devCopyRealData')}>Copy My Real Data Again…</Menu.Item>
    <Menu.Item onClick={() => run('devRemovePlugin')}>Remove the Dev Plugin…</Menu.Item>
  </Menu.Root>;
  if (isNightlyVersion(info.version)) return <Badge tone="accent">Nightly</Badge>;
  return null;
}
