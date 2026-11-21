import { cloneElement, useRef, useState, type PointerEvent, type ReactElement, type ReactNode } from 'react';
import { Tooltip } from '@envsemble/envui';

/** How long the pointer rests before a hint opens on something pointed at on purpose (a mark, a number, a link): short, since the hint is looked for. */
const hintDelay = 100;
/**
 * How long it rests before more opens over text the pointer crosses on its way elsewhere (a title, a
 * line cut short): long enough that crossing the rows opens nothing, short enough to feel asked for.
 */
export const restDelay = 500;

/** Whether an element's text is cut short: it runs past its own box, or past the box that clips it (`within`). */
export function cutShort(element: Element | null, within: Element | null = element): boolean {
  if (!element || !within) return false;
  return element === within ? element.scrollWidth > element.clientWidth + 1 : element.getBoundingClientRect().right > within.getBoundingClientRect().right + 1;
}

/** What has a hint of its own inside an element with one: a link, a button, a mark. */
const inner = 'a, button, [role="img"]';

/**
 * A short hint on hover and keyboard focus, in place of a native `title`: envUI's tooltip, opening
 * quickly, or once the pointer rests (`rest`) on text it merely crosses. `cut` shows it only while
 * the element's text is cut short, and never beside the hint of a link or a mark inside it. Without
 * anything to say, the element alone. The element is marked `data-hint`, so a row whose link covers
 * it can lift it to the pointer, and gets an empty `title`, so a `title` of something around it does
 * not show beside the hint.
 */
export function Hint({ content, children, rest = false, cut = false, side, align }: {
  content: ReactNode; children: ReactElement<{ title?: string; children?: ReactNode }>;
  rest?: boolean; cut?: boolean; side?: 'top' | 'bottom'; align?: 'start' | 'center' | 'end';
}) {
  const [open, setOpen] = useState(false);
  const element = useRef<HTMLElement>(null);
  if (!content) return children;
  const marked = cloneElement(children, { title: '', 'data-hint': '' } as object);
  const shared = { content, delay: rest ? restDelay : hintDelay, underline: false, side, align };
  if (!cut) return <Tooltip {...shared}>{marked}</Tooltip>;
  const over = (target: EventTarget | null) => { const found = (target as Element).closest(inner); return Boolean(found && found !== element.current && element.current?.contains(found)); };
  return <Tooltip {...shared} ref={element} open={open} onOpenChange={next => setOpen(next && cutShort(element.current) && !element.current?.querySelector(':is(' + inner + '):hover'))}
    onPointerOver={(event: PointerEvent) => { if (open && over(event.target)) setOpen(false); }}>{marked}</Tooltip>;
}
