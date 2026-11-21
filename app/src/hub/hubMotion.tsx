// How the hub's list changes without jumping. Motion here only says what changed: a group's parts
// fold away and come back as a panel does, and when the plans change under the eyes (an agent
// reports, a state changes, a PR merges) what stays slides to its new place, a table's frame grows
// or shrinks with its rows, and a row that arrives is uncovered where it lands. All of it runs on
// envUI's motion tokens, for the time envUI gives a panel that opens (medium, 160 ms), never delays
// a click (nothing waits for it, and a click during it lands on what is under the pointer), and is
// off when the system asks for reduced motion or the theme's durations are zero; then only the fade
// of plans shown anew (a filter, a project) remains.
import { Component, createRef, useLayoutEffect, useState, type ReactNode, type RefObject } from 'react';

/** The marks of this file's animations: what settles after a change, and a group's parts folding away. */
const settling = 'hub-settle';
const folding = 'hub-fold';

interface Motion { fast: number; medium: number; ease: string; enter: string; moves: boolean }
/** envUI's motion tokens as an element has them, and whether anything may move. */
function motionOf(element: Element): Motion {
  const style = getComputedStyle(element);
  const time = (name: string) => { const value = style.getPropertyValue(name).trim(); return (value.endsWith('ms') ? parseFloat(value) : parseFloat(value) * 1000) || 0; };
  const medium = time('--env-motion-duration-medium');
  return {
    fast: time('--env-motion-duration-fast'), medium, ease: style.getPropertyValue('--env-motion-ease').trim() || 'ease', enter: style.getPropertyValue('--env-motion-ease-enter').trim() || 'ease-out',
    moves: medium > 0 && !window.matchMedia('(prefers-reduced-motion: reduce)').matches,
  };
}

function animate(element: Element, keyframes: Keyframe[], duration: number, easing: string, id = settling, fill: FillMode = 'none') {
  const animation = element.animate(keyframes, { duration, easing, fill });
  animation.id = id;
  return animation;
}
const stop = (elements: Iterable<Element>, id: string) => { for (const element of elements) for (const animation of element.getAnimations()) if (animation.id === id) animation.cancel(); };
/**
 * An entry on its way from one offset to another. It is filled with its table's surface meanwhile, so
 * it covers the rows it passes over and uncovers the ones it leaves, as a panel's edge would (a table
 * cannot clip its rows).
 */
const moved = (from: number, to: number, surface: string) => [{ transform: 'translateY(' + from + 'px)', backgroundColor: surface }, { transform: 'translateY(' + to + 'px)', backgroundColor: surface }];
/** An entry that stays while others pass over it: kept as one layer, so nothing of it (a hint's element lies above its row's link) shows through them. */
const still = [{ transform: 'translateY(0)' }, { transform: 'translateY(0)' }];
const sized = (from: number, to: number) => [{ height: from + 'px', overflow: 'hidden' }, { height: to + 'px', overflow: 'hidden' }];
/** The surface a table's rows lie on: its frame's fill. */
const surfaceOf = (frame: Element | null) => frame ? getComputedStyle(frame).backgroundColor : 'transparent';

/** Where a part of the list shows and how tall. */
interface Place { top: number; height: number }
/** The list's groups (a heading and its table), the tables' frames and the entries (a plan's row, with its parts). */
const groups = '.hub-group', frames = '.env-table-region', entries = '.hub-entry';
/** Where every group, frame and entry shows now (mid-move included), down the scrolling page: a place there stays the same when the page scrolls. */
function measure(root: Element): Map<Element, Place> {
  const scroller = root.closest('.env-scaffold-body') ?? document.scrollingElement ?? document.documentElement;
  const offset = scroller.scrollTop - scroller.getBoundingClientRect().top;
  const places = new Map<Element, Place>();
  for (const element of root.querySelectorAll([groups, frames, entries].join(','))) {
    const box = element.getBoundingClientRect();
    places.set(element, { top: box.top + offset, height: box.height });
  }
  return places;
}

/**
 * After the list changed: start everything where it showed before and let it settle where it is now.
 * `swapped`: other plans are shown (a filter, a project), so nothing is followed and the list fades
 * in. Anything that would travel further than the window is tall is not followed either.
 */
function settle(root: Element, before: Map<Element, Place>, swapped: boolean) {
  const motion = motionOf(root);
  const all = (selector: string) => [...root.querySelectorAll(selector)];
  stop(all([groups, frames, entries].join(',')), settling);
  if (swapped) { if (motion.fast) for (const group of all(groups)) animate(group, [{ opacity: 0 }, { opacity: 1 }], motion.fast, motion.enter); return; }
  if (!motion.moves) return;
  const far = (distance: number) => Math.abs(distance) > window.innerHeight;
  const changed = (was: number, now: number) => Math.abs(was - now) > 0.5 && !far(was - now);
  const after = measure(root);
  // A frame whose rows changed grows or shrinks to them, and a group that is new opens from nothing: what follows moves with them.
  const resized = new Set<Element>();
  for (const frame of all(frames)) {
    const was = before.get(frame), now = after.get(frame)!;
    if (!was || !changed(was.height, now.height)) continue;
    animate(frame, sized(was.height, now.height), motion.medium, motion.ease);
    resized.add(frame);
  }
  for (const group of all(groups)) {
    const now = after.get(group)!;
    if (before.has(group) || far(now.height)) continue;
    animate(group, sized(0, now.height), motion.medium, motion.ease);
    animate(group, [{ opacity: 0 }, { opacity: 1 }], motion.fast, motion.enter);
  }
  // What still stands, but elsewhere than it showed, slides there: the groups, then the entries in them (which move with their group).
  const slide = (selector: string) => {
    const starts = measure(root);
    return all(selector).filter(element => { const was = before.get(element), start = starts.get(element)!; return was && changed(was.top, start.top); })
      .map(element => [element, before.get(element)!.top - starts.get(element)!.top] as const);
  };
  for (const [group, from] of slide(groups)) animate(group, moved(from, 0, 'transparent'), motion.medium, motion.ease);
  const sliding = new Map(slide(entries));
  for (const entry of all(entries)) {
    const frame = entry.closest(frames);
    const from = sliding.get(entry);
    if (from !== undefined) animate(entry, moved(from, 0, surfaceOf(frame)), motion.medium, motion.ease);
    // In a table whose rows move, the rows that stay are passed over: a row that is new is uncovered, as a group's parts are when it unfolds.
    else if (frame && (resized.has(frame) || [...sliding.keys()].some(other => other.closest(frames) === frame))) animate(entry, still, motion.medium, motion.ease);
  }
}

/**
 * Around the hub's groups: when they change, what stays is followed to its new place (see `settle`).
 * `scene` names which plans are shown (the project, the filters): when it changes the list is other
 * plans and fades in instead. It adds no box of its own to the page.
 */
export class Settled extends Component<{ scene: string; children: ReactNode }> {
  private root = createRef<HTMLDivElement>();
  override getSnapshotBeforeUpdate() { return this.root.current ? measure(this.root.current) : null; }
  override componentDidUpdate(previous: { scene: string }, _state: unknown, before: Map<Element, Place> | null) {
    if (this.root.current && before) settle(this.root.current, before, previous.scene !== this.props.scene);
  }
  override render() { return <div ref={this.root} className="hub-settled">{this.props.children}</div>; }
}

/**
 * Fold a group's parts away, as a panel closes: the table's frame shrinks by their height and the
 * rows after the group rise over them. `body` holds the group's row and its parts, still in the
 * page; `done` runs once they are covered, to take them out. An unfolding still under way is taken
 * over from where it is. Returns how to end it at once.
 */
function foldAway(body: HTMLElement, done: () => void): () => void {
  const motion = motionOf(body);
  const frame = body.closest(frames);
  const following: Element[] = [];
  for (let next = body.nextElementSibling; next; next = next.nextElementSibling) following.push(next);
  const moving = [body, ...following, ...frame ? [frame] : []];
  // How much of the parts an unfolding under way still covers: what the frame lacks of its height.
  const shown = frame?.getBoundingClientRect().height ?? 0;
  stop(moving, settling);
  const whole = frame?.getBoundingClientRect().height ?? 0;
  const hidden = Math.max(0, whole - shown);
  const parts = body.getBoundingClientRect().height - (body.firstElementChild?.getBoundingClientRect().height ?? 0);
  if (parts <= 0.5) { done(); return () => undefined; }
  const run = (element: Element, keyframes: Keyframe[]) => animate(element, keyframes, motion.medium, motion.ease, folding, 'forwards');
  const surface = surfaceOf(frame);
  for (const entry of following) run(entry, moved(-hidden, -parts, surface));
  if (frame) run(frame, sized(whole - hidden, whole - parts));
  run(body, still).onfinish = done;
  return () => stop(moving, folding);
}

/**
 * Whether a group's parts are in the page: while it is unfolded, and for the moment they take to fold
 * away once it is folded (`body`: the element that holds its row and its parts). Where nothing may
 * move, they leave at once.
 */
export function useFoldAway(body: RefObject<HTMLElement | null>, open: boolean): boolean {
  const [was, setWas] = useState(open);
  const [leaving, setLeaving] = useState(false);
  if (was !== open) { setWas(open); setLeaving(!open && body.current !== null && motionOf(body.current).moves); }
  useLayoutEffect(() => { if (leaving && body.current) return foldAway(body.current, () => setLeaving(false)); }, [leaving, body]);
  return open || leaving;
}
