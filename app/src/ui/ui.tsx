// Atlas's small vocabulary on envUI: work status icons and badges, provenance badges, a button that
// copies text, and values with more to say on hover and focus.
import { useId, useState, type ReactNode, type SVGProps } from 'react';
import { Badge, Button, Tooltip } from '@envsemble/envui';
import type { Provenance } from '@envsemble/atlas/planning/provenance';
import type { WorkStatus } from './status';
import { api } from '../api';
import { AbandonedIcon, BlockedIcon, CheckIcon, CompleteIcon, CopyIcon, DraftIcon, InProgressIcon, NeedsYouIcon, OpenIcon, PausedIcon, SupersededIcon, UnknownIcon } from './icons';

export type Tone = 'neutral' | 'accent' | 'success' | 'warning' | 'danger' | 'done';
/**
 * GitHub issue colours: work an agent is on is green, work waiting for the person amber, complete
 * work purple, blocked work red; work nobody is on stays neutral.
 */
export const statusTones: Record<WorkStatus['tone'], Tone> = { open: 'success', done: 'done', danger: 'danger', attention: 'warning', muted: 'neutral' };

const statusIcons = {
  working: InProgressIcon, waiting: NeedsYouIcon, blocked: BlockedIcon, paused: PausedIcon, draft: DraftIcon, ready: OpenIcon,
  complete: CompleteIcon, partial: InProgressIcon, superseded: SupersededIcon, abandoned: AbandonedIcon, unknown: UnknownIcon,
} satisfies Record<WorkStatus['key'], unknown>;

/** A work item's status as a coloured icon, pulsing while an agent works; named for assistive technology unless decorative. */
export function StatusIcon({ status, decorative = false, ...props }: { status: WorkStatus; decorative?: boolean } & SVGProps<SVGSVGElement>) {
  const Icon = statusIcons[status.key];
  return <Icon className={'status-icon ' + (props.className ?? '')} data-tone={statusTones[status.tone]} data-status={status.key} label={decorative ? undefined : status.label} {...props} />;
}

export function StatusBadge({ status }: { status: WorkStatus }) {
  return <Badge className="state-label" tone={statusTones[status.tone]} variant="subtle" icon={<StatusIcon status={status} decorative />}>{status.label}</Badge>;
}

export function ProvenanceBadge({ provenance, title }: { provenance: Provenance; title?: string }) {
  if (!provenance.label) return null;
  return <Badge tone={provenance.tone} title={title ?? (provenance.detail || undefined)}>{provenance.label}</Badge>;
}

/** Copies text to the clipboard, and says so for a moment. */
export function CopyButton({ text, label }: { text: string; label: string }) {
  const [done, setDone] = useState(false);
  return <Button variant="secondary" startIcon={done ? <CheckIcon /> : <CopyIcon />} onClick={() => { void api.copy(text).then(() => { setDone(true); window.setTimeout(() => setDone(false), 1500); }); }}>
    {done ? 'Copied' : label}
  </Button>;
}

/** A value with more to say: shown on hover and focus, and read as the value's description. */
export function Detailed({ children, detail, description }: { children: ReactNode; detail: ReactNode; description: string }) {
  const id = useId();
  return <>
    <Tooltip content={detail}><span className="detailed" tabIndex={0} aria-describedby={id}>{children}</span></Tooltip>
    <span id={id} hidden>{description}</span>
  </>;
}
