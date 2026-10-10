// An editor tab strip. Preview tabs show in italics; double-clicking one pins it, middle-click closes.
import { XIcon } from '@primer/octicons-react';
import type { ReactNode } from 'react';

export interface TabItem { id: string; label: string; title?: string; icon?: ReactNode; preview: boolean }

export function TabStrip({ tabs, active, label, onActivate, onClose, onPin }: {
  tabs: TabItem[]; active: string | null; label: string;
  onActivate(id: string): void; onClose(id: string): void; onPin(id: string): void;
}) {
  return <div className="tab-strip" role="tablist" aria-label={label}>
    {tabs.map(tab => <div key={tab.id} role="tab" tabIndex={tab.id === active ? 0 : -1} aria-selected={tab.id === active} data-tab={tab.id}
      className={'tab' + (tab.id === active ? ' active' : '') + (tab.preview ? ' preview' : '')} title={tab.title ?? tab.label}
      onClick={() => onActivate(tab.id)} onDoubleClick={() => onPin(tab.id)}
      onAuxClick={event => { if (event.button === 1) { event.preventDefault(); onClose(tab.id); } }}
      onKeyDown={event => {
        if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); onActivate(tab.id); }
        if (event.key === 'ArrowRight' || event.key === 'ArrowLeft') {
          event.preventDefault();
          const index = tabs.findIndex(item => item.id === tab.id) + (event.key === 'ArrowRight' ? 1 : -1);
          const next = tabs[(index + tabs.length) % tabs.length];
          if (next) { onActivate(next.id); (event.currentTarget.parentElement?.querySelector(`[data-tab="${CSS.escape(next.id)}"]`) as HTMLElement | null)?.focus(); }
        }
      }}>
      {tab.icon}
      <span className="tab-label">{tab.label}</span>
      <button type="button" className="tab-close" aria-label={'Close ' + tab.label} tabIndex={-1} onClick={event => { event.stopPropagation(); onClose(tab.id); }}><XIcon size={14} /></button>
    </div>)}
  </div>;
}
