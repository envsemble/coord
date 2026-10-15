import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { CommandPalette, type CommandPaletteItem } from '@envsemble/envui';
import { DiagramIcon, FileIcon } from './icons';
import type { DiagramIndexEntry, Project, Snapshot } from './types';
import { api } from './api';
import { rankItems, type QuickItem } from './quickMatch';
import { diagramTarget, fileTarget, workTarget, type Place } from './targets';
import { workStatus } from './status';
import { workNumber } from './format';
import { StatusIcon } from './ui';

interface Entry extends QuickItem { place: Place; icon: ReactNode }
const groups: Record<string, string> = { work: 'Work', diagram: 'Diagrams', file: 'Files' };

/**
 * Ctrl+P: jump to any work item, document or diagram by name, in the projects of the window's
 * computer (their snapshots as read so far; diagrams are listed as they arrive). In "work" mode it
 * picks a work item.
 */
export function QuickOpen({ projects, snapshots, mode = 'all', placeholder, onPick, onClose }: {
  projects: Project[]; snapshots: Record<string, Snapshot>; mode?: 'all' | 'work'; placeholder?: string;
  onPick(place: Place, pin: boolean): void; onClose(): void;
}) {
  const [query, setQuery] = useState('');
  const [diagrams, setDiagrams] = useState<Record<string, DiagramIndexEntry[]>>({});
  const read = projects.filter(project => snapshots[project.folderId]);
  useEffect(() => {
    if (mode !== 'all') return;
    let current = true;
    for (const project of read) {
      if (diagrams[project.folderId]) continue;
      api.diagramIndex(project.folderId).then(items => { if (current) setDiagrams(previous => ({ ...previous, [project.folderId]: items })); }).catch(() => undefined);
    }
    return () => { current = false; };
  }, [mode, read.map(project => project.folderId).join(' ')]);

  const entries = useMemo(() => {
    const several = read.length > 1;
    const all: Entry[] = [];
    for (const project of read) {
      const snapshot = snapshots[project.folderId];
      const of = (detail: string) => several ? project.name + ' · ' + detail : detail;
      const place = (target: Place['target']): Place => ({ project: project.folderId, target });
      const titles = new Map(snapshot.work.map(work => [work.id, work.title]));
      all.push(...[...snapshot.work].sort((a, b) => b.id.localeCompare(a.id)).map(item => ({
        id: project.folderId + ':work:' + item.id, kind: 'work' as const, label: item.title, detail: of(workNumber(item.id) + ' · ' + item.path), place: place(workTarget(item.id)),
        icon: <StatusIcon status={workStatus(item)} decorative />,
      })));
      if (mode === 'work') continue;
      // A diagram is listed once, by its title; its file is not listed again.
      const listed = diagrams[project.folderId] ?? [];
      const paths = new Set(listed.map(item => snapshot.work.find(work => work.id === item.workId)?.path + '/' + item.path));
      all.push(...listed.map(item => ({
        id: project.folderId + ':diagram:' + item.workId + ':' + item.path, kind: 'diagram' as const, label: item.title,
        detail: of([workNumber(item.workId) + ' ' + (titles.get(item.workId) ?? ''), item.provenance.label].filter(Boolean).join(' · ')),
        place: place(diagramTarget(item.workId, item.path)), icon: <DiagramIcon />,
      })));
      all.push(...snapshot.documents.filter(file => !paths.has(file.path)).map(file => ({ id: project.folderId + ':file:' + file.path, kind: 'file' as const, label: file.name, detail: of(file.path), place: place(fileTarget(file.path)), icon: <FileIcon /> })));
    }
    // Work first, then diagrams, then files, across the projects.
    const order = ['work', 'diagram', 'file'];
    return all.sort((a, b) => order.indexOf(a.kind) - order.indexOf(b.kind));
  }, [read, snapshots, diagrams, mode]);
  const results = useMemo(() => rankItems(entries, query), [entries, query]);
  const byId = useMemo(() => new Map(results.map(entry => [entry.id, entry])), [results]);
  // Without a query the list reads best grouped; a query ranks across kinds.
  // The name read out includes the path, so many plan.md files stay apart.
  const items: CommandPaletteItem[] = results.map(entry => ({ id: entry.id, label: entry.label, textValue: entry.label + ', ' + entry.detail, detail: entry.detail, icon: entry.icon, group: query ? undefined : groups[entry.kind] }));

  return <CommandPalette open onOpenChange={open => { if (!open) onClose(); }} className="quick-open" aria-label={mode === 'work' ? 'Choose a work item' : 'Quick open'}
    query={query} onQueryChange={setQuery} items={items} placeholder={placeholder ?? 'Go to a work item, document or diagram'} emptyLabel="No matches"
    footer={mode === 'all' ? 'Enter opens a preview tab · Ctrl+Enter keeps it open' : undefined}
    onSelect={(item, { modifier }) => {
      const entry = byId.get(item.id);
      if (!entry) return;
      onClose();
      onPick(entry.place, mode === 'work' || modifier);
    }} />;
}
