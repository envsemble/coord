import { useLayoutEffect, useRef, type RefObject } from 'react';
import { SegmentedControl, Surface } from '@envsemble/envui';
import type { WorkSection } from './types';

export interface SectionOption { value: WorkSection; label: string; count?: number }

/**
 * Keyboard focus that follows a switcher which a section change moved: `focusMemory` (kept by the page)
 * says whether the previous one had focus. The radios take it once envUI's radio group has registered
 * them, a frame later, or the arrow keys would not move from the focused one.
 */
export function useFocusFollows(focusMemory: RefObject<boolean>) {
  const root = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const element = root.current;
    let pending = focusMemory.current;
    focusMemory.current = false;
    const frame = pending ? requestAnimationFrame(() => { pending = false; element?.querySelector<HTMLElement>('[aria-checked="true"]')?.focus(); }) : 0;
    return () => {
      cancelAnimationFrame(frame);
      focusMemory.current = pending || Boolean(element?.contains(document.activeElement));
    };
  }, [focusMemory]);
  return root;
}

/**
 * A work item's sections (Plan, Ledger, Diagrams) as one compact switcher, floating at the top left of
 * the work page at the same spot in every section: in the reading sections it sticks while the page
 * scrolls, and in Diagrams it starts the diagram's overlay. It is a radio group, so it can sit among
 * the diagram's own controls. Moving between the page and the overlay makes it a new element, so
 * keyboard focus is carried over to the new one.
 */
export function WorkSections({ options, value, onChange, focusMemory }: {
  options: SectionOption[]; value: WorkSection; onChange(section: WorkSection): void; focusMemory: RefObject<boolean>;
}) {
  const root = useFocusFollows(focusMemory);
  return <Surface ref={root} tone="pane" corners="pill" padding={1} density="compact" className="section-switcher">
    <SegmentedControl aria-label="Work sections" size="compact" value={value} onValueChange={next => onChange(next as WorkSection)}
      options={options.map(option => ({ value: option.value, label: option.label, count: option.count || undefined }))} />
  </Surface>;
}
