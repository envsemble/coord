// A two-pane layout with a draggable, keyboard-resizable divider. The first pane can be hidden.
import { useRef, type KeyboardEvent, type PointerEvent, type ReactNode } from 'react';

export function SplitPane({ size, min, max, visible, label, onResize, start, end }: {
  size: number; min: number; max: number; visible: boolean; label: string;
  onResize(size: number): void; start: ReactNode; end: ReactNode;
}) {
  const drag = useRef<{ origin: number; size: number } | null>(null);
  const clamp = (value: number) => Math.round(Math.max(min, Math.min(max, value)));
  const down = (event: PointerEvent<HTMLDivElement>) => {
    event.currentTarget.setPointerCapture(event.pointerId);
    drag.current = { origin: event.clientX, size };
    document.body.classList.add('is-resizing');
  };
  const moveTo = (event: PointerEvent<HTMLDivElement>) => {
    if (drag.current) onResize(clamp(drag.current.size + event.clientX - drag.current.origin));
  };
  const up = () => { drag.current = null; document.body.classList.remove('is-resizing'); };
  const key = (event: KeyboardEvent) => {
    const step = event.shiftKey ? 48 : 16;
    if (event.key === 'ArrowLeft') { event.preventDefault(); onResize(clamp(size - step)); }
    if (event.key === 'ArrowRight') { event.preventDefault(); onResize(clamp(size + step)); }
  };
  return <div className="split-pane" style={{ gridTemplateColumns: visible ? `${size}px 0px minmax(0, 1fr)` : 'minmax(0, 1fr)' }}>
    {visible && <>
      <div className="split-pane-start">{start}</div>
      <div className="split-pane-divider" role="separator" aria-orientation="vertical" aria-label={label} aria-valuenow={size} aria-valuemin={min} aria-valuemax={max} tabIndex={0}
        onPointerDown={down} onPointerMove={moveTo} onPointerUp={up} onPointerCancel={up} onKeyDown={key} />
    </>}
    <div className="split-pane-end">{end}</div>
  </div>;
}
