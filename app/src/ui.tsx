import { useEffect, useRef, useState, type ReactNode } from 'react';
import { BlockedIcon, CheckIcon, CircleSlashIcon, IssueClosedIcon, IssueDraftIcon, IssueOpenedIcon, QuestionIcon, SkipIcon, TriangleDownIcon } from './icons';
import type { WorkStatus } from './status';
import type { Provenance } from '@envsemble/atlas-planning/provenance';

export function Label({ children, tone = 'default', title }: { children: ReactNode; tone?: string; title?: string }) {
  return <span className={'label label-' + tone} title={title}>{children}</span>;
}
export function Counter({ children }: { children: ReactNode }) { return <span className="counter-label">{children}</span>; }

export function StatusIcon({ status, size = 16 }: { status: WorkStatus; size?: number }) {
  const props = { size, className: 'status-icon status-' + status.tone, 'aria-label': status.label };
  switch (status.key) {
    case 'complete': return <IssueClosedIcon {...props} />;
    case 'blocked': return <BlockedIcon {...props} />;
    case 'draft': return <IssueDraftIcon {...props} />;
    case 'superseded': return <SkipIcon {...props} />;
    case 'abandoned': return <CircleSlashIcon {...props} />;
    case 'unknown': return <QuestionIcon {...props} />;
    default: return <IssueOpenedIcon {...props} />;
  }
}
/** GitHub-style state pill: filled for open/done/blocked, outlined otherwise. */
export function StateLabel({ status }: { status: WorkStatus }) {
  return <span className={'state-label state-' + status.tone}><StatusIcon status={status} size={14} />{status.label}</span>;
}
export function ProvenanceLabel({ provenance, title }: { provenance: Provenance; title?: string }) {
  if (!provenance.label) return null;
  return <Label tone={provenance.tone} title={title ?? (provenance.detail || undefined)}>{provenance.label}</Label>;
}

export function Blankslate({ icon, title, children, action }: { icon?: ReactNode; title: string; children?: ReactNode; action?: ReactNode }) {
  return <div className="blankslate">{icon}<h3>{title}</h3>{children != null && <p>{children}</p>}{action}</div>;
}
export function Spinner({ size = 16 }: { size?: number }) {
  return <svg className="spinner" width={size} height={size} viewBox="0 0 16 16" fill="none" aria-hidden="true"><circle cx="8" cy="8" r="7" stroke="currentColor" strokeOpacity=".25" strokeWidth="2" /><path d="M15 8a7 7 0 0 0-7-7" stroke="currentColor" strokeWidth="2" strokeLinecap="round" /></svg>;
}

/** Close a popover on outside pointer down or Escape (Escape is consumed so it does not also leave full view). */
export function useDismiss(open: boolean, close: (focusButton: boolean) => void) {
  const root = useRef<HTMLDivElement>(null);
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

export function Dropdown({ label, button, children, align = 'start', className = '', buttonClassName = 'btn', title, onOpenChange }: {
  label: string; button: ReactNode; children: (close: () => void) => ReactNode; align?: 'start' | 'end'; className?: string; buttonClassName?: string; title?: string; onOpenChange?(open: boolean): void;
}) {
  const [open, setOpen] = useState(false);
  const trigger = useRef<HTMLButtonElement>(null);
  const changed = useRef(onOpenChange);
  changed.current = onOpenChange;
  const close = useRef((focus: boolean) => { setOpen(false); changed.current?.(false); if (focus) trigger.current?.focus(); }).current;
  const root = useDismiss(open, close);
  return <div className={'dropdown ' + className} ref={root}>
    <button ref={trigger} type="button" className={buttonClassName} aria-haspopup="dialog" aria-expanded={open} aria-label={label} title={title} onClick={() => { const next = !open; setOpen(next); changed.current?.(next); }}>{button}</button>
    {open && <div className={'overlay overlay-' + align} role="dialog" aria-label={label}>{children(() => close(true))}</div>}
  </div>;
}

export interface Option { value: string; label: string; count?: number }
/** Primer-style select menu: a compact button showing the current value, opening a checkable list. */
export function SelectMenu({ label, value, options, onChange, icon }: { label: string; value: string; options: Option[]; onChange(value: string): void; icon?: ReactNode }) {
  const current = options.find(option => option.value === value) ?? options[0];
  return <Dropdown label={label} align="end" buttonClassName="btn btn-select" button={<>{icon}<span className="btn-select-text"><span className="muted">{label}:</span> {current?.label}</span><TriangleDownIcon size={16} /></>}>
    {close => <div className="action-menu" role="menu">
      <div className="menu-title">{label}</div>
      {options.map(option => <button key={option.value} type="button" role="menuitemradio" aria-checked={option.value === value} className="menu-item" onClick={() => { onChange(option.value); close(); }}>
        <span className="menu-check">{option.value === value && <CheckIcon size={16} />}</span>
        <span className="menu-text">{option.label}</span>{option.count !== undefined && <span className="menu-meta">{option.count}</span>}
      </button>)}
    </div>}
  </Dropdown>;
}
