// What the hub's rows say when pointed at. A mark, a number or a date answers almost at once (the
// Hint's quick delay); text the pointer crosses on its way (a plan's title, a line cut short) answers
// once the pointer rests. A plan's title opens a card with its summary: a paragraph, so it opens from
// the title's own letters and never from the rest of its row.
import type { ReactNode } from 'react';
import { Text } from '@envsemble/envui';
import type { ProjectWork } from '../types';
import { cardLeaves, cards, cutShort, hints, pressed, restDelay, type Asked } from '../ui/Hint';
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


/**
 * A plan's title in its row, with a card of its summary above the row (as the hints open), so the row
 * itself and the rows still to read stay in sight; the card starts with the whole title where the row
 * cuts it short. The card opens when the pointer has rested half a second on the title's letters
 * (lifted above the link that covers the row, so the rest of the row opens nothing; every move starts
 * the wait again), or when keyboard focus rests as long on the row's link. A press never opens it: a
 * click opens the plan or folds the group, and the card would come up over what the click did. The
 * card stays while the pointer is on the title or on the card, and leaves soon after. A plan without
 * a summary has a card only while its title is cut short. The card is the window's one
 * hint (`hints`), in the page only while it shows: a row costs no more to draw than without it.
 */
export function PlanName({ title, summary }: { title: string; summary: string | null }) {
  const card = (name: Element) => (): Asked | null => {
    const cut = cutShort(name, name.parentElement);
    if (!summary && !cut) return null;
    return { card: true, side: 'top', align: 'start', content: <>{cut && <Text render={<strong />}>{title}</Text>}{summary && <Text emphasis="muted">{summary}</Text>}</> };
  };
  return <span className="hub-row-name" data-card="" ref={name => { if (name) cards.set(name, card(name)); }}
    onPointerMove={({ currentTarget: name }) => { if (!pressed.has(name)) hints.wait(name, restDelay, card(name), () => name.matches(':hover') && !pressed.has(name)); }}
    onPointerDown={({ currentTarget: name }) => { pressed.add(name); hints.close(name); }}
    onPointerLeave={({ currentTarget: name }) => { pressed.delete(name); hints.close(name, cardLeaves); }}>{title}</span>;
}
