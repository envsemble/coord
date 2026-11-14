// The badge beside the title bar's logo for a build that is not a stable release.
import { Badge } from '@envsemble/envui';
import { isNightlyVersion } from '../../shared/contract';
import type { WindowInfo } from '../types';

/** Beside the logo, a build that is not a stable release says so: Coord Dev (on a copy of the data, main/dev.ts) as Dev, a nightly build as Nightly. */
export function BuildBadge({ info }: { info: Pick<WindowInfo, 'dev' | 'version'> }) {
  if (info.dev) return <Badge tone="warning">Dev</Badge>;
  if (isNightlyVersion(info.version)) return <Badge tone="accent">Nightly</Badge>;
  return null;
}
