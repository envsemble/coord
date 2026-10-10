import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { FileIcon, SearchIcon, WorkflowIcon } from './icons';
import type { DiagramIndexEntry, Snapshot, Target } from './types';
import { api } from './api';
import { rankItems, type QuickItem } from './quickMatch';
import { fileTarget, workTarget } from './targets';
import { workStatus } from './status';
import { workNumber } from './format';
import { StatusIcon } from './ui';
import { Dialog } from './components/Dialog';

interface Entry extends QuickItem { target: Target; icon: ReactNode }

/** Ctrl+P: jump to any work item, file or diagram by name. In "work" mode it picks a work item. */
export function QuickOpen({ snapshot, mode = 'all', placeholder, onPick, onClose }: {
  snapshot: Snapshot; mode?: 'all' | 'work'; placeholder?: string;
  onPick(target: Target, pin: boolean): void; onClose(): void;
}) {
  const [query, setQuery] = useState('');
  const [selected, setSelected] = useState(0);
  const [diagrams, setDiagrams] = useState<DiagramIndexEntry[]>([]);
  const list = useRef<HTMLUListElement>(null);
  useEffect(() => {
    if (mode !== 'all') return;
    let current = true;
    api.diagrams().then(items => { if (current) setDiagrams(items); }).catch(() => undefined);
    return () => { current = false; };
  }, [mode]);

  const entries = useMemo(() => {
    const titles = new Map(snapshot.work.map(work => [work.id, work.title]));
    const work: Entry[] = [...snapshot.work].sort((a, b) => b.id.localeCompare(a.id)).map(item => ({
      id: 'work:' + item.id, kind: 'work', label: item.title, detail: workNumber(item.id) + ' · ' + item.path, target: workTarget(item.id),
      icon: <StatusIcon status={workStatus(item)} />,
    }));
    if (mode === 'work') return work;
    const files: Entry[] = snapshot.documents.map(file => ({ id: 'file:' + file.path, kind: 'file', label: file.name, detail: file.path, target: fileTarget(file.path), icon: <FileIcon size={16} /> }));
    const models: Entry[] = diagrams.map(item => ({
      id: 'diagram:' + item.workId + ':' + item.handle, kind: 'diagram', label: item.title,
      detail: [workNumber(item.workId) + ' ' + (titles.get(item.workId) ?? ''), item.provenance.label].filter(Boolean).join(' · '),
      target: workTarget(item.workId, 'diagrams', { diagram: item.handle }), icon: <WorkflowIcon size={16} />,
    }));
    return [...work, ...models, ...files];
  }, [snapshot, diagrams, mode]);
  const results = useMemo(() => rankItems(entries, query), [entries, query]);
  useEffect(() => setSelected(0), [query]);
  useEffect(() => { list.current?.querySelector('[aria-selected="true"]')?.scrollIntoView({ block: 'nearest' }); }, [selected]);

  const pick = (entry: Entry | undefined, pin: boolean) => { if (!entry) return; onClose(); onPick(entry.target, pin); };
  return <Dialog label={mode === 'work' ? 'Choose a work item' : 'Quick open'} onClose={onClose} placement="top" className="quick-open">
    <div className="search-box quick-open-input">
      <SearchIcon size={16} />
      <input autoFocus value={query} placeholder={placeholder ?? 'Go to a work item, file or diagram'} aria-label="Search" role="combobox" aria-expanded="true" aria-controls="quick-open-results"
        aria-activedescendant={results[selected] ? 'quick-' + selected : undefined}
        onChange={event => setQuery(event.target.value)}
        onKeyDown={event => {
          if (event.key === 'ArrowDown') { event.preventDefault(); setSelected(value => Math.min(results.length - 1, value + 1)); }
          if (event.key === 'ArrowUp') { event.preventDefault(); setSelected(value => Math.max(0, value - 1)); }
          if (event.key === 'Enter') { event.preventDefault(); pick(results[selected], mode === 'work' || event.ctrlKey || event.metaKey); }
        }} />
    </div>
    <ul ref={list} id="quick-open-results" className="quick-open-results" role="listbox" aria-label="Results">
      {results.map((entry, index) => <li key={entry.id} id={'quick-' + index} role="option" aria-selected={index === selected} className={'quick-open-item' + (index === selected ? ' selected' : '')}
        onPointerMove={() => setSelected(index)} onClick={event => pick(entry, mode === 'work' || event.ctrlKey || event.metaKey)}>
        <span className="quick-open-icon">{entry.icon}</span>
        <span className="quick-open-label">{entry.label}</span>
        <span className="quick-open-detail">{entry.detail}</span>
      </li>)}
      {!results.length && <li className="quick-open-empty">No matches</li>}
    </ul>
  </Dialog>;
}
