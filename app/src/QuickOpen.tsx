import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { CommandPalette, type CommandPaletteItem } from '@envsemble/envui';
import { DiagramIcon, FileIcon } from './icons';
import type { DiagramIndexEntry, Snapshot, Target } from './types';
import { api } from './api';
import { rankItems, type QuickItem } from './quickMatch';
import { fileTarget, workTarget } from './targets';
import { workStatus } from './status';
import { workNumber } from './format';
import { StatusIcon } from './ui';

interface Entry extends QuickItem { target: Target; icon: ReactNode }
const groups: Record<string, string> = { work: 'Work', diagram: 'Diagrams', file: 'Files' };

/** Ctrl+P: jump to any work item, file or diagram by name. In "work" mode it picks a work item. */
export function QuickOpen({ snapshot, mode = 'all', placeholder, onPick, onClose }: {
  snapshot: Snapshot; mode?: 'all' | 'work'; placeholder?: string;
  onPick(target: Target, pin: boolean): void; onClose(): void;
}) {
  const [query, setQuery] = useState('');
  const [diagrams, setDiagrams] = useState<DiagramIndexEntry[]>([]);
  useEffect(() => {
    if (mode !== 'all') return;
    let current = true;
    api.diagramIndex().then(items => { if (current) setDiagrams(items); }).catch(() => undefined);
    return () => { current = false; };
  }, [mode]);

  const entries = useMemo(() => {
    const titles = new Map(snapshot.work.map(work => [work.id, work.title]));
    const work: Entry[] = [...snapshot.work].sort((a, b) => b.id.localeCompare(a.id)).map(item => ({
      id: 'work:' + item.id, kind: 'work', label: item.title, detail: workNumber(item.id) + ' · ' + item.path, target: workTarget(item.id),
      icon: <StatusIcon status={workStatus(item)} decorative />,
    }));
    if (mode === 'work') return work;
    // A diagram is listed once, by its title; its file is not listed again.
    const paths = new Set(diagrams.map(item => snapshot.work.find(work => work.id === item.workId)?.path + '/' + item.path));
    const files: Entry[] = snapshot.documents.filter(file => !paths.has(file.path)).map(file => ({ id: 'file:' + file.path, kind: 'file', label: file.name, detail: file.path, target: fileTarget(file.path), icon: <FileIcon /> }));
    const listed: Entry[] = diagrams.map(item => ({
      id: 'diagram:' + item.workId + ':' + item.path, kind: 'diagram', label: item.title,
      detail: [workNumber(item.workId) + ' ' + (titles.get(item.workId) ?? ''), item.provenance.label].filter(Boolean).join(' · '),
      target: workTarget(item.workId, 'diagrams', { diagram: item.path }), icon: <DiagramIcon />,
    }));
    return [...work, ...listed, ...files];
  }, [snapshot, diagrams, mode]);
  const results = useMemo(() => rankItems(entries, query), [entries, query]);
  const byId = useMemo(() => new Map(results.map(entry => [entry.id, entry])), [results]);
  // Without a query the list reads best grouped; a query ranks across kinds.
  // The name read out includes the path, so many plan.md files stay apart.
  const items: CommandPaletteItem[] = results.map(entry => ({ id: entry.id, label: entry.label, textValue: entry.label + ', ' + entry.detail, detail: entry.detail, icon: entry.icon, group: query ? undefined : groups[entry.kind] }));

  return <CommandPalette open onOpenChange={open => { if (!open) onClose(); }} className="quick-open" aria-label={mode === 'work' ? 'Choose a work item' : 'Quick open'}
    query={query} onQueryChange={setQuery} items={items} placeholder={placeholder ?? 'Go to a work item, file or diagram'} emptyLabel="No matches"
    footer={mode === 'all' ? 'Enter opens a preview tab · Ctrl+Enter keeps it open' : undefined}
    onSelect={(item, { modifier }) => {
      const entry = byId.get(item.id);
      if (!entry) return;
      onClose();
      onPick(entry.target, mode === 'work' || modifier);
    }} />;
}
