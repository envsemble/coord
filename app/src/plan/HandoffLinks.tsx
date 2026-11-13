// Handoffs as the plan page and the hub show them (see handoffs.ts): a reference to the other plan,
// "#0023 · Plans hub" (and its project's name when it is another project's), opening it; the ledger's
// entries above and after the steps; and "continued in #0026" on closed work's status line.
import type { MouseEvent, ReactNode } from 'react';
import { IconArrowBack as ArrowBack } from '@envsemble/envui/icons/ArrowBack';
import { IconArrowForward as ArrowForward } from '@envsemble/envui/icons/ArrowForward';
import type { Handoff } from './handoffs';

/** Opens another plan: its project's ID and its work ID. */
export type OpenHandoff = (to: { projectId: string; work: string }) => void;

/** The other plan by its number and title, a link where it can be opened; muted text where it cannot. */
function HandoffRef({ item, open, short = false }: { item: Handoff; open: OpenHandoff; short?: boolean }) {
  const text = [item.number, !short && item.title, item.project].filter(Boolean).join(' · ');
  const title = [item.number, item.title, item.project].filter(Boolean).join(' · ');
  if (!item.open) return <span className="handoff-ref muted" title={title + ' (not found)'}>{text}</span>;
  const to = item.open;
  const activate = (event: MouseEvent) => { event.preventDefault(); event.stopPropagation(); open(to); };
  return <a href="#" className="handoff-ref" title={title} draggable={false} onClick={activate}>{text}</a>;
}

/** The ledger's entries for the plan's handoffs: `continues` before its steps, `continuedIn` after them; list items. */
export function HandoffEntries({ items, kind, open }: { items: Handoff[]; kind: 'continues' | 'continuedIn'; open: OpenHandoff }): ReactNode {
  return items.map(item => <li key={kind + item.key} className="ledger-handoff" data-handoff={kind}>
    {kind === 'continues' ? <ArrowBack className="ledger-handoff-icon" /> : <ArrowForward className="ledger-handoff-icon" />}
    <span>{kind === 'continues' ? 'Continues ' : 'Continued in '}<HandoffRef item={item} open={open} /></span>
  </li>);
}

/** "continued in #0026, #0027" on a closed plan's status line or hub row. */
export function ContinuedIn({ items, open }: { items: Handoff[]; open: OpenHandoff }) {
  if (!items.length) return null;
  return <span className="handoff-continued">continued in {items.map((item, index) => <span key={item.key}>{index ? ', ' : ''}<HandoffRef item={item} open={open} short /></span>)}</span>;
}
