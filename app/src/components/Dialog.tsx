// A modal dialog: Escape and a click outside close it, focus stays inside and returns afterwards.
import { useEffect, useRef, type KeyboardEvent, type ReactNode } from 'react';

export function Dialog({ label, onClose, children, className = '', placement = 'center' }: { label: string; onClose(): void; children: ReactNode; className?: string; placement?: 'center' | 'top' }) {
  const panel = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    const first = panel.current?.querySelector<HTMLElement>('[autofocus], input, button, [tabindex="0"]');
    (first ?? panel.current)?.focus();
    return () => previous?.focus?.();
  }, []);
  const key = (event: KeyboardEvent) => {
    if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); onClose(); return; }
    if (event.key !== 'Tab' || !panel.current) return;
    const focusable = [...panel.current.querySelectorAll<HTMLElement>('input, button:not(:disabled), [tabindex="0"], a[href]')];
    if (!focusable.length) return;
    const index = focusable.indexOf(document.activeElement as HTMLElement);
    if (event.shiftKey && index <= 0) { event.preventDefault(); focusable.at(-1)!.focus(); }
    else if (!event.shiftKey && index === focusable.length - 1) { event.preventDefault(); focusable[0].focus(); }
  };
  return <div className={'dialog-backdrop dialog-' + placement} onPointerDown={event => { if (event.target === event.currentTarget) onClose(); }}>
    <div ref={panel} className={'dialog ' + className} role="dialog" aria-modal="true" aria-label={label} tabIndex={-1} onKeyDown={key}>{children}</div>
  </div>;
}
