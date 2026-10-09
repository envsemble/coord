// Menus: a context menu opened at a point, and a Primer-style select menu on a button.
import { useEffect, useLayoutEffect, useState, type KeyboardEvent, type ReactNode } from 'react';
import { CheckIcon, TriangleDownIcon } from '@primer/octicons-react';
import { Popover, useDismiss } from './Popover';

export type MenuEntry = { label: string; icon?: ReactNode; disabled?: boolean; onSelect(): void } | 'separator';

export function ContextMenu({ items, position, label, onClose }: { items: MenuEntry[]; position: { x: number; y: number }; label: string; onClose(): void }) {
  const root = useDismiss<HTMLDivElement>(true, onClose);
  const [place, setPlace] = useState(position);
  useLayoutEffect(() => {
    const element = root.current;
    if (!element) return;
    const { width, height } = element.getBoundingClientRect();
    setPlace({ x: Math.max(4, Math.min(position.x, window.innerWidth - width - 4)), y: Math.max(4, Math.min(position.y, window.innerHeight - height - 4)) });
  }, [position, root]);
  useEffect(() => { root.current?.querySelector<HTMLButtonElement>('button:not(:disabled)')?.focus(); }, [root]);
  const keyDown = (event: KeyboardEvent) => {
    if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return;
    event.preventDefault();
    const buttons = [...(root.current?.querySelectorAll<HTMLButtonElement>('button:not(:disabled)') ?? [])];
    const index = buttons.indexOf(document.activeElement as HTMLButtonElement);
    buttons[(index + (event.key === 'ArrowDown' ? 1 : -1) + buttons.length) % buttons.length]?.focus();
  };
  return <div ref={root} className="context-menu action-menu" role="menu" aria-label={label} style={{ left: place.x, top: place.y }} onKeyDown={keyDown}>
    {items.map((item, index) => item === 'separator'
      ? <div key={index} className="menu-separator" role="separator" />
      : <button key={index} type="button" role="menuitem" className="menu-item" disabled={item.disabled} onClick={() => { onClose(); item.onSelect(); }}>
        <span className="menu-check">{item.icon}</span><span className="menu-text">{item.label}</span>
      </button>)}
  </div>;
}

export interface Option { value: string; label: string; count?: number }
/** Primer-style select menu: a compact button showing the current value, opening a checkable list. */
export function SelectMenu({ label, value, options, onChange, icon }: { label: string; value: string; options: Option[]; onChange(value: string): void; icon?: ReactNode }) {
  const current = options.find(option => option.value === value) ?? options[0];
  return <Popover label={label} align="end" buttonClassName="btn btn-select" button={<>{icon}<span className="btn-select-text"><span className="muted">{label}:</span> {current?.label}</span><TriangleDownIcon size={16} /></>}>
    {close => <div className="action-menu" role="menu">
      <div className="menu-title">{label}</div>
      {options.map(option => <button key={option.value} type="button" role="menuitemradio" aria-checked={option.value === value} className="menu-item" onClick={() => { onChange(option.value); close(); }}>
        <span className="menu-check">{option.value === value && <CheckIcon size={16} />}</span>
        <span className="menu-text">{option.label}</span>{option.count !== undefined && <span className="menu-meta">{option.count}</span>}
      </button>)}
    </div>}
  </Popover>;
}

export function useContextMenu<T>() {
  const [menu, setMenu] = useState<{ subject: T; position: { x: number; y: number } } | null>(null);
  return { menu, open: (subject: T, position: { x: number; y: number }) => setMenu({ subject, position }), close: () => setMenu(null) };
}
