// Anchored popovers: a trigger button and a floating panel that closes on outside click or Escape.
import { useEffect, useRef, useState, type ReactNode } from 'react';

/** Close a popover on outside pointer down or Escape (Escape is consumed so it does not also leave full view). */
export function useDismiss<T extends HTMLElement = HTMLDivElement>(open: boolean, close: (focusButton: boolean) => void) {
  const root = useRef<T>(null);
  useEffect(() => {
    if (!open) return;
    const down = (event: PointerEvent) => { if (root.current && !root.current.contains(event.target as Node)) close(false); };
    const key = (event: KeyboardEvent) => { if (event.key === 'Escape') { event.stopPropagation(); close(true); } };
    document.addEventListener('pointerdown', down);
    document.addEventListener('keydown', key, true);
    return () => { document.removeEventListener('pointerdown', down); document.removeEventListener('keydown', key, true); };
  }, [open, close]);
  return root;
}

export function Popover({ label, button, children, align = 'start', placement = 'below', className = '', buttonClassName = 'btn', title, onOpenChange }: {
  label: string; button: ReactNode; children: (close: () => void) => ReactNode; align?: 'start' | 'end'; placement?: 'below' | 'right';
  className?: string; buttonClassName?: string; title?: string; onOpenChange?(open: boolean): void;
}) {
  const [open, setOpen] = useState(false);
  const trigger = useRef<HTMLButtonElement>(null);
  const changed = useRef(onOpenChange);
  changed.current = onOpenChange;
  const close = useRef((focus: boolean) => { setOpen(false); changed.current?.(false); if (focus) trigger.current?.focus(); }).current;
  const root = useDismiss(open, close);
  return <div className={'dropdown ' + className} ref={root}>
    <button ref={trigger} type="button" className={buttonClassName} aria-haspopup="dialog" aria-expanded={open} aria-label={label} title={title} onClick={() => { const next = !open; setOpen(next); changed.current?.(next); }}>{button}</button>
    {open && <div className={'overlay overlay-' + align + (placement === 'right' ? ' overlay-right' : '')} role="dialog" aria-label={label}>{children(() => close(true))}</div>}
  </div>;
}
