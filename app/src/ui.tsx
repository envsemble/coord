// Atlas's small vocabulary on envUI: work status icons and badges, provenance and repository badges.
import type { SVGProps } from 'react';
import { Badge } from '@envsemble/envui';
import type { Provenance } from '@envsemble/atlas-planning/provenance';
import type { WorkStatus } from './status';
import { AbandonedIcon, BlockedIcon, CompleteIcon, DraftIcon, InProgressIcon, OpenIcon, SupersededIcon, UnknownIcon } from './icons';

export type Tone = 'neutral' | 'accent' | 'success' | 'warning' | 'danger' | 'done';
/** GitHub issue colours: open work is green, complete work purple, blocked work red. */
export const statusTones: Record<WorkStatus['tone'], Tone> = { open: 'success', done: 'done', danger: 'danger', attention: 'warning', muted: 'neutral' };

const statusIcons = {
  complete: CompleteIcon, blocked: BlockedIcon, draft: DraftIcon, superseded: SupersededIcon, abandoned: AbandonedIcon, unknown: UnknownIcon,
  in_progress: InProgressIcon, partial: InProgressIcon, not_started: OpenIcon,
} satisfies Record<WorkStatus['key'], unknown>;

/** A work item's status as a coloured icon; named for assistive technology unless decorative. */
export function StatusIcon({ status, decorative = false, ...props }: { status: WorkStatus; decorative?: boolean } & SVGProps<SVGSVGElement>) {
  const Icon = statusIcons[status.key];
  return <Icon className={'status-icon ' + (props.className ?? '')} data-tone={statusTones[status.tone]} label={decorative ? undefined : status.label} {...props} />;
}

export function StatusBadge({ status }: { status: WorkStatus }) {
  return <Badge className="state-label" tone={statusTones[status.tone]} variant="subtle" icon={<StatusIcon status={status} decorative />}>{status.label}</Badge>;
}

export function ProvenanceBadge({ provenance, title }: { provenance: Provenance; title?: string }) {
  if (!provenance.label) return null;
  return <Badge tone={provenance.tone} title={title ?? (provenance.detail || undefined)}>{provenance.label}</Badge>;
}

export function RepositoryBadge({ id }: { id: string }) {
  return <Badge variant="outline">{id}</Badge>;
}
