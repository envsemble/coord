// How the hub's list changes without jumping. Motion here only says what changed: a group's parts
// fold away and come back as a panel does, and when the plans change under the eyes (an agent
// reports, a state changes, a PR merges) what stays slides to its new place, a table's frame grows
// or shrinks with its rows, a row that arrives is uncovered where it lands, and one that leaves fades
// where it stood as the rows after it close over it. One mechanism does all of it (`settle`): the
// list is measured before it changes and again after, and everything starts where it showed and ends
// where it is, so a change that comes while another still moves is taken over from where things are.
// It runs on envUI's motion tokens, for the time envUI gives a panel that opens (medium, 160 ms),
// and never delays a click: the page is in its new state from the first frame, and a click during
// the motion lands on what is under the pointer. Other plans (a filter, a project) are simply shown,
// as fast as before. Where the system asks for reduced motion, or the theme's durations are zero,
// nothing moves.
import { Component, createRef, type ReactNode } from 'react';
import { Column } from '@envsemble/envui';

/** The mark of this file's animations. */
const settling = 'hub-settle';
/** The mark of a copy left where something stood (see `leave`). */
const ghost = 'hub-ghost';

interface Motion { medium: number; ease: string; exit: string; moves: boolean }
/** envUI's motion tokens as an element has them, and whether anything may move. */
function motionOf(element: Element): Motion {
  const style = getComputedStyle(element);
  const time = (name: string) => { const value = style.getPropertyValue(name).trim(); return (value.endsWith('ms') ? parseFloat(value) : parseFloat(value) * 1000) || 0; };
  const medium = time('--env-motion-duration-medium');
  return { medium, ease: style.getPropertyValue('--env-motion-ease').trim() || 'ease', exit: style.getPropertyValue('--env-motion-ease-exit').trim() || 'ease-in', moves: medium > 0 && !window.matchMedia('(prefers-reduced-motion: reduce)').matches };
}

/** The animations of the change being settled, which `run` then steps frame by frame. */
let held: Animation[] = [];
function animate(element: Element, keyframes: Keyframe[], motion: Motion, easing = motion.ease, fill: FillMode = 'none') {
  const animation = element.animate(keyframes, { duration: motion.medium, easing, fill });
  animation.id = settling;
  animation.pause();
  held.push(animation);
  return animation;
}
/** The most of a motion's time that one frame may take, in milliseconds: a frame of a 60 Hz screen. */
const stride = 17;
/**
 * Run the held animations on a clock of their own, which a late frame cannot run away with: every
 * frame moves them on by the time since the last one, but never by more than `stride`. The first
 * time rows move as layers of their own the page pauses about a tenth of a second to set them up
 * (once in a window's life); on the page's clock that pause would swallow most of a 160 ms motion in
 * one jump. So the motion starts once its first frame has been painted, and a frame that comes late
 * makes it last that much longer instead of skipping ahead.
 */
function run(duration: number) {
  const moving = held;
  held = [];
  let at = 0, last: number | null = null;
  const frame = (now: number) => {
    const live = moving.filter(animation => animation.playState === 'paused');
    if (!live.length) return;
    at += last === null ? 0 : Math.min(now - last, stride);
    last = now;
    if (at >= duration) { for (const animation of live) animation.finish(); return; }
    for (const animation of live) animation.currentTime = at;
    requestAnimationFrame(frame);
  };
  if (moving.length) requestAnimationFrame(frame);
}

/**
 * An entry on its way from where it showed to where it is. It is filled with its table's surface
 * meanwhile, so it covers the rows it passes over and uncovers the ones it leaves, as a panel's edge
 * would (a table cannot clip its rows).
 */
const moved = (from: number, surface: string) => [{ transform: 'translateY(' + from + 'px)', backgroundColor: surface }, { transform: 'translateY(0)', backgroundColor: surface }];
/** An entry that stays while others pass over it: kept as one layer, so nothing of it (a hint's element lies above its row's link) shows through them. */
const still = [{ transform: 'translateY(0)' }, { transform: 'translateY(0)' }];
const sized = (from: number, to: number) => [{ height: from + 'px', overflow: 'hidden' }, { height: to + 'px', overflow: 'hidden' }];
/** The surface a table's rows lie on: its frame's fill. */
const surfaceOf = (frame: Element | null) => frame ? getComputedStyle(frame).backgroundColor : 'transparent';

/**
 * Where a part of the list shows and how tall; for an entry also its rows with where each shows, and
 * the table and the frame it is in, should it or some of its rows leave.
 */
interface Place { top: number; height: number; rows?: (readonly [Element, number])[]; table?: Element | null; frame?: Element | null }
/** The list's groups (a heading and its table), the tables' frames and the entries (a plan's row, with its parts). */
const groups = '.hub-group', frames = '.env-table-region', entries = '.hub-entry';
const pieces = [groups, frames, entries].join(',');
/** Where the list, and every group, frame and entry of it, shows now (mid-move included), down the scrolling page: a place there stays the same when the page scrolls. */
function measure(root: Element): Map<Element, Place> {
  const scroller = root.closest('.env-scaffold-body') ?? document.scrollingElement ?? document.documentElement;
  const offset = scroller.scrollTop - scroller.getBoundingClientRect().top;
  const places = new Map<Element, Place>([[root, { top: root.getBoundingClientRect().top + offset, height: 0 }]]);
  for (const element of root.querySelectorAll(pieces)) {
    if (element.closest('.' + ghost)) continue;
    const box = element.getBoundingClientRect();
    const place: Place = { top: box.top + offset, height: box.height };
    // Only an entry of several rows (a group with its parts) needs its rows told apart.
    if (element.matches(entries)) Object.assign(place, { table: element.parentElement, frame: element.closest(frames), rows: element.children.length > 1 ? [...element.children].map(row => [row, row.getBoundingClientRect().top + offset] as const) : [[element, place.top] as const] });
    places.set(element, place);
  }
  return places;
}

/**
 * What left the list fades where it stood instead of vanishing: a group's parts when it folds, a plan
 * that changed groups, a group that emptied. It is a lifeless copy, out of the page's flow, which
 * the rows after it close over. The copy takes no pointer, focus or name, and leaves with its fade.
 */
function leave(root: Element, before: Map<Element, Place>, motion: Motion, far: (distance: number) => boolean) {
  const fade = (copy: HTMLElement, into: Element, top: number) => {
    copy.classList.add(ghost);
    copy.setAttribute('aria-hidden', 'true');
    copy.inert = true;
    for (const named of [copy, ...copy.querySelectorAll('[id]')]) named.removeAttribute('id');
    copy.style.top = top + 'px';
    into.prepend(copy);
    const fading = animate(copy, [{ opacity: 1 }, { opacity: 0 }], motion, motion.exit, 'forwards');
    fading.onfinish = fading.oncancel = () => copy.remove();
  };
  for (const [element, was] of before) {
    if (far(was.height)) continue;
    if (!element.isConnected && element.matches(groups)) {
      // A group that emptied: its heading and its table, where they stood in the list.
      fade(element.cloneNode(true) as HTMLElement, root, was.top - before.get(root)!.top);
      continue;
    }
    // Rows that left a table that stays (a whole entry, or a group's parts as it folds): in a table of their own with the same columns, where they stood in the frame.
    const gone = was.rows?.filter(([row]) => !row.isConnected) ?? [];
    if (!gone.length || !was.frame?.isConnected || !was.table?.isConnected) continue;
    const table = was.table.cloneNode(false) as HTMLElement;
    const columns = was.table.querySelector(':scope > colgroup');
    if (columns) table.append(columns.cloneNode(true));
    if (gone[0][0] === element) table.append(element.cloneNode(true));
    else {
      const body = element.cloneNode(false) as HTMLElement;
      body.append(...gone.map(([row]) => row.cloneNode(true)));
      // The first part's upper corners follow the group's row above it, which is not copied.
      (body.firstElementChild as HTMLElement).style.setProperty('--hub-tile-top', 'var(--hub-tile-outer)');
      table.append(body);
    }
    fade(table, was.frame, gone[0][1] - before.get(was.frame)!.top - was.frame.clientTop);
  }
}

/**
 * After the list changed: start everything where it showed before (`before`) and let it settle where
 * it is now. Without `before` (other plans are shown), whatever still moved stops and nothing is
 * followed. Anything that would travel further than the window is tall is not followed either: it is
 * simply there.
 */
function settle(root: Element, before: Map<Element, Place> | null) {
  const motion = motionOf(root);
  for (const element of root.querySelectorAll(pieces)) for (const animation of element.getAnimations()) if (animation.id === settling) animation.cancel();
  for (const copy of root.querySelectorAll('.' + ghost)) copy.remove();
  if (!before || !motion.moves) return;
  const all = (selector: string) => [...root.querySelectorAll(selector)];
  const far = (distance: number) => Math.abs(distance) > window.innerHeight;
  const changed = (was: number, now: number) => Math.abs(was - now) > 0.5 && !far(was - now);
  const after = measure(root);
  leave(root, before, motion, far);
  // A frame whose rows changed grows or shrinks to them, and a group that is new opens from nothing: what follows moves with them.
  const resized = new Set<Element | null>();
  for (const frame of all(frames)) {
    const was = before.get(frame), now = after.get(frame);
    if (!was || !now || !changed(was.height, now.height)) continue;
    animate(frame, sized(was.height, now.height), motion);
    resized.add(frame);
  }
  for (const group of all(groups)) {
    const now = after.get(group);
    if (!now || before.has(group) || far(now.height)) continue;
    animate(group, sized(0, now.height), motion);
    animate(group, [{ opacity: 0 }, { opacity: 1 }], motion);
  }
  // What still stands, but elsewhere than it showed, slides there: the groups, then the entries in them (which move with their group).
  const slide = (selector: string) => {
    const starts = measure(root);
    return all(selector).flatMap(element => { const was = before.get(element), start = starts.get(element); return was && start && changed(was.top, start.top) ? [[element, was.top - start.top] as const] : []; });
  };
  for (const [group, from] of slide(groups)) animate(group, moved(from, 'transparent'), motion);
  const sliding = new Map(slide(entries));
  const busy = new Set([...resized, ...[...sliding.keys()].map(entry => entry.closest(frames))]);
  for (const entry of all(entries)) {
    const frame = entry.closest(frames);
    if (!after.has(entry) || !busy.has(frame)) continue;
    const from = sliding.get(entry);
    // In a table whose rows move, the rows that stay are passed over: a row that is new is uncovered, as a group's parts are when it unfolds.
    animate(entry, from === undefined ? still : moved(from, surfaceOf(frame)), motion);
  }
  run(motion.medium);
}

/**
 * Around the hub's groups: when they change, what stays is followed to its new place (see `settle`).
 * `scene` names which plans are shown (the project, the filters): when it changes the list is other
 * plans, shown at once. It is a column of the page's own spacing, in which a group that left fades.
 */
export class Settled extends Component<{ scene: string; children: ReactNode }> {
  private root = createRef<HTMLDivElement>();
  override getSnapshotBeforeUpdate(previous: { scene: string }) { return this.root.current && previous.scene === this.props.scene ? measure(this.root.current) : null; }
  override componentDidUpdate(_previous: unknown, _state: unknown, before: Map<Element, Place> | null) { if (this.root.current) settle(this.root.current, before); }
  override render() { return <Column ref={this.root} gap={5} className="hub-settled">{this.props.children}</Column>; }
}
