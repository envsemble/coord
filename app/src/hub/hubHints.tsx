// What the hub's rows say when pointed at. A mark, a number or a date answers almost at once (the
// Hint's quick delay); text the pointer crosses on its way (a plan's title, a line cut short) answers
// once the pointer rests. A plan's title opens a card with its whole title and its summary: a
// paragraph, so it opens from the title's own letters and never from the rest of its row.
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { HoverCard, Text } from '@envsemble/envui';
import type { ProjectWork } from '../types';
import { cutShort, restDelay } from '../ui/Hint';
import type { HubItem } from './hubPlans';

/** A hint's lines, one under the other; those with nothing to say are left out. */
export function lines(...items: (string | null | false | undefined)[]): ReactNode {
  const said = items.filter(Boolean);
  return said.length ? said.map((line, index) => <span key={index} className="hint-line">{line}</span>) : null;
}

/** The steps bar spelled out: steps done of all, split into planning and implementation, and the step worked on or next. */
export function stepsHint(work: ProjectWork, planningOnly: boolean): ReactNode {
  const steps = work.steps;
  if (!steps) return null;
  const doing = work.step?.status === 'doing';
  const all = steps.total - steps.planning.total;
  const counted = planningOnly ? steps.planning.done + ' of ' + steps.planning.total + ' planning steps done' : steps.done + ' of ' + steps.total + ' steps done';
  return lines(
    counted + (doing ? ', one in progress' : ''),
    !planningOnly && steps.planning.total > 0 && all > 0 && 'Planning ' + steps.planning.done + ' of ' + steps.planning.total + ' · Implementation ' + (steps.done - steps.planning.done) + ' of ' + all,
    work.step && (doing ? 'Now: ' : 'Next: ') + work.step.title,
  );
}

/** A group's parts, one a line: its place, its title and whose turn it is. */
export const partLines = (parts: HubItem[]): string[] => parts.map((part, index) => index + 1 + '. ' + part.work.title + ' · ' + part.status.label);

/** The plan's title as its row's link holds it. envUI asks a card's text trigger for a tab stop of its own; this one is inside the row's link, whose focus opens the card. */
const Words = ({ children }: { children: string }) => children;

/**
 * A plan's title in its row, with a card of its whole title and its summary, above the row (as the
 * hints open), so the row itself and the rows still to read stay in sight. The card opens when the
 * pointer rests on the title's letters (lifted above the link that covers the row, so the rest of the
 * row opens nothing), or when keyboard focus rests on the row's link. A plan without a summary has a
 * card only while its title is cut short.
 */
export function PlanName({ title, summary }: { title: string; summary: string | null }) {
  const [open, setOpen] = useState(false);
  const name = useRef<HTMLSpanElement>(null);
  const says = () => Boolean(summary) || cutShort(name.current, name.current?.parentElement);
  useEffect(() => {
    const link = name.current?.closest('a, button');
    if (!link) return;
    let timer = 0;
    const focused = () => { if (link.matches(':focus-visible')) timer = window.setTimeout(() => setOpen(says()), restDelay); };
    const left = () => { window.clearTimeout(timer); setOpen(false); };
    link.addEventListener('focus', focused);
    link.addEventListener('blur', left);
    return () => { window.clearTimeout(timer); link.removeEventListener('focus', focused); link.removeEventListener('blur', left); };
  }, [summary]);
  return <HoverCard open={open} onOpenChange={next => setOpen(next && says())} delay={restDelay} side="top" align="start" width="lg" underline={false}
    trigger={<span ref={name} className="hub-row-name"><Words>{title}</Words></span>}>
    <Text render={<strong />}>{title}</Text>
    {summary && <Text emphasis="muted">{summary}</Text>}
  </HoverCard>;
}
