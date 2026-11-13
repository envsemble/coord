// Atlas's badges on envUI: a work item's status as an icon or a badge, and a provenance badge.
import type { SVGProps } from 'react';
import { Badge } from '@envsemble/envui';
import type { Provenance } from '@envsemble/atlas/planning/provenance';
import type { StatusLook } from '../plan/status';
import { AbandonedIcon, BlockedIcon, CompleteIcon, DraftIcon, InProgressIcon, NeedsYouIcon, OpenIcon, PausedIcon, SupersededIcon, UnknownIcon } from './icons';

export type Tone = 'neutral' | 'primary' | 'accent' | 'success' | 'warning' | 'danger';
/**
 * GitHub issue colours: work an agent is on is green, work waiting for the person amber, complete
 * work purple, blocked work red; work nobody is on stays neutral.
 */
export const statusTones: Record<StatusLook['tone'], Tone> = { open: 'success', started: 'primary', done: 'accent', danger: 'danger', attention: 'warning', muted: 'neutral' };

const statusIcons = {
  working: InProgressIcon, waiting: NeedsYouIcon, blocked: BlockedIcon, paused: PausedIcon, draft: DraftIcon, ready: OpenIcon,
  complete: CompleteIcon, partial: InProgressIcon, superseded: SupersededIcon, abandoned: AbandonedIcon, unknown: UnknownIcon,
} satisfies Record<StatusLook['key'], unknown>;

/** A work item's status as a coloured icon, pulsing while an agent works; named for assistive technology unless decorative. */
export function StatusIcon({ status, decorative = false, ...props }: { status: StatusLook; decorative?: boolean } & SVGProps<SVGSVGElement>) {
  const Icon = statusIcons[status.key];
  return <Icon className={'status-icon ' + (props.className ?? '')} data-tone={statusTones[status.tone]} data-status={status.key} label={decorative ? undefined : status.label} {...props} />;
}

export function StatusBadge({ status }: { status: StatusLook }) {
  return <Badge className="state-label" tone={statusTones[status.tone]} variant="soft" icon={<StatusIcon status={status} decorative />}>{status.label}</Badge>;
}

export function ProvenanceBadge({ provenance, title }: { provenance: Provenance; title?: string }) {
  if (!provenance.label) return null;
  return <Badge tone={provenance.tone} title={title ?? (provenance.detail || undefined)}>{provenance.label}</Badge>;
}
