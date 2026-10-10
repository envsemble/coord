// A virtualized tree view: only the rows in view are in the DOM, so folders with thousands of
// files scroll smoothly. Keyboard follows the WAI-ARIA tree pattern (arrows, Home/End, Enter).
import { useCallback, useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent, type MouseEvent, type ReactNode } from 'react';
import { ChevronRightIcon } from '@primer/octicons-react';

export interface TreeRow { id: string; depth: number; expandable: boolean; expanded: boolean }
export type TreeOpen = 'preview' | 'pin';

export function Tree<T extends TreeRow>({ rows, selected, label, rowHeight = 22, overscan = 8, onOpen, onToggle, onContextMenu, renderRow }: {
  rows: T[];
  selected: string | null;
  label: string;
  rowHeight?: number;
  overscan?: number;
  onOpen(row: T, mode: TreeOpen): void;
  onToggle(row: T, expanded: boolean): void;
  onContextMenu?(row: T, position: { x: number; y: number }): void;
  renderRow(row: T): ReactNode;
}) {
  const viewport = useRef<HTMLDivElement>(null);
  const [scrollTop, setScrollTop] = useState(0);
  const [height, setHeight] = useState(400);
  const [focused, setFocused] = useState<string | null>(selected);
  const focusIndex = Math.max(0, rows.findIndex(row => row.id === focused));

  useLayoutEffect(() => {
    const element = viewport.current;
    if (!element) return;
    const observer = new ResizeObserver(() => setHeight(element.clientHeight));
    observer.observe(element);
    setHeight(element.clientHeight);
    return () => observer.disconnect();
  }, []);

  const scrollIntoView = useCallback((index: number) => {
    const element = viewport.current;
    if (!element || index < 0) return;
    const top = index * rowHeight;
    if (top < element.scrollTop) element.scrollTop = top;
    else if (top + rowHeight > element.scrollTop + element.clientHeight) element.scrollTop = top + rowHeight - element.clientHeight;
  }, [rowHeight]);

  // Follow the selection (the active tab) when it changes.
  useEffect(() => {
    if (!selected) return;
    setFocused(selected);
    scrollIntoView(rows.findIndex(row => row.id === selected));
    // Rows change when folders expand to reveal the selection, so they are a dependency too.
  }, [selected, rows, scrollIntoView]);

  const move = (index: number) => {
    const next = rows[Math.max(0, Math.min(rows.length - 1, index))];
    if (!next) return;
    setFocused(next.id);
    scrollIntoView(rows.indexOf(next));
  };
  const keyDown = (event: KeyboardEvent) => {
    const row = rows[focusIndex];
    if (!row) return;
    const handled = () => { event.preventDefault(); event.stopPropagation(); };
    switch (event.key) {
      case 'ArrowDown': handled(); move(focusIndex + 1); break;
      case 'ArrowUp': handled(); move(focusIndex - 1); break;
      case 'Home': handled(); move(0); break;
      case 'End': handled(); move(rows.length - 1); break;
      case 'PageDown': handled(); move(focusIndex + Math.floor(height / rowHeight)); break;
      case 'PageUp': handled(); move(focusIndex - Math.floor(height / rowHeight)); break;
      case 'ArrowRight':
        handled();
        if (row.expandable && !row.expanded) onToggle(row, true);
        else if (row.expandable) move(focusIndex + 1);
        break;
      case 'ArrowLeft': {
        handled();
        if (row.expandable && row.expanded) { onToggle(row, false); break; }
        for (let index = focusIndex - 1; index >= 0; index--) if (rows[index].depth < row.depth) { move(index); break; }
        break;
      }
      case 'Enter': handled(); onOpen(row, 'pin'); break;
      case ' ': handled(); onOpen(row, 'preview'); break;
      case 'ContextMenu': {
        if (!onContextMenu) break;
        handled();
        const rect = viewport.current?.getBoundingClientRect();
        onContextMenu(row, { x: (rect?.left ?? 0) + 24, y: (rect?.top ?? 0) + (focusIndex + 1) * rowHeight - (viewport.current?.scrollTop ?? 0) });
        break;
      }
    }
  };

  const first = Math.max(0, Math.floor(scrollTop / rowHeight) - overscan);
  const last = Math.min(rows.length, Math.ceil((scrollTop + height) / rowHeight) + overscan);
  const click = (row: T, event: MouseEvent) => {
    setFocused(row.id);
    viewport.current?.focus({ preventScroll: true });
    if (event.detail === 2) onOpen(row, 'pin');
    else onOpen(row, 'preview');
  };

  return <div ref={viewport} className="tree-view" role="tree" aria-label={label} tabIndex={0} aria-activedescendant={rows[focusIndex] ? 'tree-' + rows[focusIndex].id : undefined}
    onScroll={event => setScrollTop(event.currentTarget.scrollTop)} onKeyDown={keyDown}>
    <div className="tree-view-spacer" style={{ height: rows.length * rowHeight }}>
      {rows.slice(first, last).map((row, offset) => {
        const index = first + offset;
        return <div key={row.id} id={'tree-' + row.id} role="treeitem" aria-level={row.depth + 1} aria-expanded={row.expandable ? row.expanded : undefined} aria-selected={row.id === selected}
          data-id={row.id}
          className={'tree-row' + (row.id === selected ? ' selected' : '') + (index === focusIndex ? ' focused' : '')}
          style={{ top: index * rowHeight, height: rowHeight, paddingLeft: 8 + row.depth * 12 }}
          onClick={event => click(row, event)}
          onContextMenu={event => { if (!onContextMenu) return; event.preventDefault(); setFocused(row.id); onContextMenu(row, { x: event.clientX, y: event.clientY }); }}>
          <span className="tree-twistie" onClick={event => { if (!row.expandable) return; event.stopPropagation(); setFocused(row.id); onToggle(row, !row.expanded); }}>
            {row.expandable && <ChevronRightIcon size={16} className={'tree-chevron' + (row.expanded ? ' open' : '')} />}
          </span>
          {renderRow(row)}
        </div>;
      })}
    </div>
  </div>;
}
