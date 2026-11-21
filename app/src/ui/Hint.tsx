import { cloneElement, useEffect, useSyncExternalStore, type PointerEvent, type ReactElement, type ReactNode } from 'react';
import { HoverCard, Tooltip } from '@envsemble/envui';

/** How long the pointer rests before a hint opens on something pointed at on purpose (a mark, a number, a link): short, since the hint is looked for. */
export const hintDelay = 100;
/**
 * How long it rests before more opens over text the pointer crosses on its way elsewhere (a title, a
 * line cut short): long enough that crossing the rows opens nothing, short enough to feel asked for.
 */
export const restDelay = 500;
/** How long a hint that closed stays in the page, for envUI's fade. */
const fadeOut = 200;

/** Whether an element's text is cut short: it runs past its own box, or past the box that clips it (`within`). */
export function cutShort(element: Element | null, within: Element | null = element): boolean {
  if (!element || !within) return false;
  return element === within ? element.scrollWidth > element.clientWidth + 1 : element.getBoundingClientRect().right > within.getBoundingClientRect().right + 1;
}

/** What has a hint of its own inside an element with one: a link, a button, a mark. */
const inner = 'a, button, [data-hint]';

type Side = 'top' | 'bottom';
type Align = 'start' | 'center' | 'end';
/** What a hint shows and where: a tooltip beside its element, or (`card`) a card for a paragraph. */
export interface Asked { content: ReactNode; side?: Side; align?: Align; card?: boolean }
/** The hint the window shows: where its element stood when it opened, and whether it is open (closed, it fades). */
interface Showing { id: number; box: DOMRect; open: boolean; hint: Asked }

// One hint at a time, for the whole window: the elements only say when the pointer comes and goes,
// and the window's hint layer (`HintLayer`) shows the one that is due. A list has hints by the
// hundred; this way a row costs no more to draw than a row without them.
let showing: Showing | null = null;
let shownAt: Element | null = null;
let shownText: string | null = null;
let waitingAt: Element | null = null;
let waiting = 0, closing = 0, entering = 0, shows = 0;
const watchers = new Set<() => void>();
const show = (next: Showing | null) => { showing = next; for (const watcher of watchers) watcher(); };
const watch = (watcher: () => void) => { watchers.add(watcher); return () => { watchers.delete(watcher); }; };

export const hints = {
  /**
   * Open a hint at an element once `delay` has passed, if `when` then holds (the pointer still rests
   * there, say) and there is something to show (`hint` may be worked out then). Asked again for the
   * same element, the wait starts over; while its hint shows, nothing changes.
   */
  wait(element: Element, delay: number, hint: Asked | (() => Asked | null), when: () => boolean) {
    if (shownAt === element) { window.clearTimeout(closing); return; }
    window.clearTimeout(waiting);
    waitingAt = element;
    waiting = window.setTimeout(() => {
      waitingAt = null;
      const asked = element.isConnected && when() ? typeof hint === 'function' ? hint() : hint : null;
      if (!asked) return;
      window.clearTimeout(closing);
      shownAt = element;
      shownText = element.textContent;
      // It enters the page closed and opens in the next frame, so envUI's fade plays.
      show({ id: ++shows, box: element.getBoundingClientRect(), open: false, hint: asked });
      window.cancelAnimationFrame(entering);
      entering = window.requestAnimationFrame(() => { if (showing && shownAt === element) show({ ...showing, open: true }); });
    }, delay);
  },
  /** Forget the wait at an element and close its hint, at once or `after` a moment; without an element, whichever hint waits or shows. */
  close(element?: Element, after = 0) {
    if (!element || waitingAt === element) { window.clearTimeout(waiting); waitingAt = null; }
    if (element && shownAt !== element) return;
    window.clearTimeout(closing);
    const end = () => { window.cancelAnimationFrame(entering); shownAt = null; if (showing?.open) show({ ...showing, open: false }); else if (showing) show(null); };
    if (after) closing = window.setTimeout(end, after); else end();
  },
  /** Keep the hint that shows: the pointer went from its element onto the hint itself (a card is read there). */
  keep() { window.clearTimeout(closing); },
  /** Whether the element the hint is for still stands where the hint opened and says what it said: a list may change under it. */
  stands() { const now = shownAt?.isConnected ? shownAt.getBoundingClientRect() : null; return now !== null && showing !== null && shownAt!.textContent === shownText && Math.abs(now.top - showing.box.top) < 1 && Math.abs(now.left - showing.box.left) < 1; },
};
/** How long a card stays once the pointer has left it and its element: it holds text only, so it clears what it covers about as fast as a hint does, with time enough to cross from the one to the other. */
export const cardLeaves = 150;

/** What a press is on: no hint opens there until the pointer has left it. A click acts (it opens a plan, folds a group), and a hint would come up over what it did. */
export const pressed = new WeakSet<Element>();

/** Elements whose card opens when keyboard focus rests on the link around them: what to show, worked out when it opens. */
export const cards = new WeakMap<Element, () => Asked | null>();

/**
 * The window's hint: envUI's tooltip (or its hover card) beside an invisible anchor laid over the
 * element it is for, in the page only while it shows. It closes when the page scrolls, a key is
 * pressed, or its element moves, changes its text or leaves the page (a list changing under it), and leaves the page
 * once envUI's fade is over. A card stays while the pointer is on it. Keyboard focus resting on a
 * link opens the card of what it holds (see `cards`).
 */
export function HintLayer() {
  const shown = useSyncExternalStore(watch, () => showing);
  useEffect(() => {
    const close = () => hints.close();
    const focused = (event: FocusEvent) => {
      const link = event.target instanceof Element && event.target.matches(':focus-visible') ? event.target : null;
      const held = link?.querySelector('[data-card]');
      const asked = held && cards.get(held);
      if (link && held && asked) hints.wait(held, restDelay, asked, () => link.matches(':focus-visible'));
    };
    window.addEventListener('scroll', close, true);
    window.addEventListener('keydown', close, true);
    window.addEventListener('focusin', focused);
    window.addEventListener('focusout', close);
    return () => { window.removeEventListener('scroll', close, true); window.removeEventListener('keydown', close, true); window.removeEventListener('focusin', focused); window.removeEventListener('focusout', close); };
  }, []);
  useEffect(() => {
    if (!shown) return;
    if (!shown.open) {
      const timer = window.setTimeout(() => { if (showing === shown) show(null); }, fadeOut);
      return () => window.clearTimeout(timer);
    }
    // While it shows, it is checked every frame against the element it is for.
    let frame = window.requestAnimationFrame(function check() { if (hints.stands()) frame = window.requestAnimationFrame(check); else hints.close(); });
    return () => window.cancelAnimationFrame(frame);
  }, [shown]);
  if (!shown) return null;
  const { box, hint } = shown;
  const anchor = <span className="hint-anchor" aria-hidden="true" style={{ left: box.left, top: box.top, width: box.width, height: box.height }} />;
  const closed = (next: boolean) => { if (!next) hints.close(); };
  return hint.card ? <HoverCard key={shown.id} open={shown.open} onOpenChange={closed} side={hint.side} align={hint.align} width="lg" underline={false} trigger={anchor}
    onPointerEnter={() => hints.keep()} onPointerLeave={() => hints.close(undefined, cardLeaves)}>{hint.content}</HoverCard>
    : <Tooltip key={shown.id} content={hint.content} open={shown.open} onOpenChange={closed} underline={false} side={hint.side} align={hint.align}>{anchor}</Tooltip>;
}

/**
 * A short hint on hover and keyboard focus, in place of a native `title`: envUI's tooltip, opening
 * quickly, or once the pointer rests (`rest`) on text it merely crosses. Without anything to say, the
 * element alone. The element is marked `data-hint`, so a row whose link covers it can lift it to the
 * pointer, and gets an empty `title`, so a `title` of something around it does not show beside the hint.
 *
 * A control (a link, a button) is wrapped in the tooltip, which then also opens on its keyboard focus
 * and describes it. Plain text and marks only listen for the pointer: resting on one opens its hint
 * in the window's hint layer (a `rest` hint counts from the pointer's last move); leaving it,
 * pressing it, scrolling or a key closes it, and once pressed it stays closed until the pointer has left. `cut` shows the hint only while the element's text is
 * cut short, and never beside the hint of a link or a mark inside it.
 */
export function Hint({ content, children, rest = false, cut = false, side, align }: {
  content: ReactNode; children: ReactElement<{ title?: string; children?: ReactNode }>;
  rest?: boolean; cut?: boolean; side?: Side; align?: Align;
}) {
  if (!content) return children;
  if (typeof children.type !== 'string') return <Tooltip content={content} delay={rest ? restDelay : hintDelay} underline={false} side={side} align={align}>{cloneElement(children, { title: '', 'data-hint': '' } as object)}</Tooltip>;
  const asked = { content, side, align };
  const over = (event: PointerEvent<HTMLElement>) => {
    const element = event.currentTarget;
    // Over a link or a mark inside it, that one's hint is the answer.
    const within = (event.target as Element).closest(inner);
    if (pressed.has(element) || (within && within !== element && element.contains(within))) { hints.close(element); return; }
    hints.wait(element, rest ? restDelay : hintDelay, asked, () => element.matches(':hover') && !pressed.has(element) && !(cut && !cutShort(element)) && !element.querySelector(':is(' + inner + '):hover'));
  };
  const leave = ({ currentTarget }: PointerEvent<HTMLElement>) => { pressed.delete(currentTarget); hints.close(currentTarget); };
  const press = ({ currentTarget }: PointerEvent<HTMLElement>) => { pressed.add(currentTarget); hints.close(currentTarget); };
  return cloneElement(children, { title: '', 'data-hint': '', onPointerOver: over, onPointerMove: rest ? over : undefined, onPointerLeave: leave, onPointerDown: press } as object);
}
