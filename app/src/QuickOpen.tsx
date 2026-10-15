import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { CommandPalette, type CommandPaletteItem } from '@envsemble/envui';
import { DiagramIcon, FileIcon } from './icons';
import type { DiagramIndexEntry, Project, Snapshot, Target } from './types';
import { api } from './api';
import { rankItems, type QuickItem } from './quickMatch';
import { hubGroups, hubItems, hubStatus } from './hubPlans';
import { diagramTarget, fileTarget, workTarget, type Place } from './targets';
import { workNumber } from './format';
import { StatusIcon } from './ui';

interface Entry extends QuickItem { place: Place; icon: ReactNode }
const groups: Record<string, string> = { work: 'Plans', diagram: 'Diagrams', file: 'Files' };

/**
 * Ctrl+P: jump to a plan of any active project of the window's computer (from the project list), or
 * to a diagram or document of the open plan's project (`open`, with its snapshot; diagrams are
 * listed as they arrive).
 */
export function QuickOpen({ projects, open, onPick, onClose }: {
  projects: Project[]; open: { project: string; snapshot: Snapshot } | null; onPick(place: Place): void; onClose(): void;
}) {
  const [query, setQuery] = useState('');
  const [diagrams, setDiagrams] = useState<DiagramIndexEntry[]>([]);
  const project = open?.project ?? null;
  useEffect(() => {
    if (!project) return;
    let current = true;
    api.diagramIndex(project).then(items => { if (current) setDiagrams(items); }).catch(() => undefined);
    return () => { current = false; };
  }, [project]);

  const entries = useMemo(() => {
    // Every plan of the active projects, and of the open one whatever its state, in the hub's order.
    const listed = [...hubItems(projects, null), ...project && projects.find(item => item.folderId === project)?.state !== 'active' ? hubItems(projects, project) : []];
    const all: Entry[] = hubGroups(listed, 'all', '').flatMap(group => group.items).map(({ project: owner, work }) => ({
      id: owner.folderId + ':work:' + work.id, kind: 'work' as const, label: work.title, detail: owner.name + ' · ' + workNumber(work.id),
      place: { project: owner.folderId, target: workTarget(work.id) }, icon: <StatusIcon status={hubStatus(work)} decorative />,
    }));
    if (open) {
      const { snapshot } = open;
      const place = (target: Target): Place => ({ project: open.project, target });
      const titles = new Map(snapshot.work.map(work => [work.id, work.title]));
      // A diagram is listed once, by its title; its file is not listed again.
      const paths = new Set(diagrams.map(item => snapshot.work.find(work => work.id === item.workId)?.path + '/' + item.path));
      all.push(...diagrams.map(item => ({
        id: open.project + ':diagram:' + item.workId + ':' + item.path, kind: 'diagram' as const, label: item.title,
        detail: [workNumber(item.workId) + ' ' + (titles.get(item.workId) ?? ''), item.provenance.label].filter(Boolean).join(' · '),
        place: place(diagramTarget(item.workId, item.path)), icon: <DiagramIcon />,
      })));
      all.push(...snapshot.documents.filter(file => !paths.has(file.path)).map(file => ({ id: open.project + ':file:' + file.path, kind: 'file' as const, label: file.name, detail: file.path, place: place(fileTarget(file.path)), icon: <FileIcon /> })));
    }
    return all;
  }, [projects, project, open, diagrams]);
  const results = useMemo(() => rankItems(entries, query), [entries, query]);
  const byId = useMemo(() => new Map(results.map(entry => [entry.id, entry])), [results]);
  // Without a query the list reads best grouped; a query ranks across kinds.
  // The name read out includes the path, so many plan.md files stay apart.
  const items: CommandPaletteItem[] = results.map(entry => ({ id: entry.id, label: entry.label, textValue: entry.label + ', ' + entry.detail, detail: entry.detail, icon: entry.icon, group: query ? undefined : groups[entry.kind] }));

  return <CommandPalette open onOpenChange={value => { if (!value) onClose(); }} className="quick-open" aria-label="Quick open"
    query={query} onQueryChange={setQuery} items={items} placeholder={open ? 'Go to a plan, or a document or diagram of this project' : 'Go to a plan'} emptyLabel="No matches"
    onSelect={item => {
      const entry = byId.get(item.id);
      if (!entry) return;
      onClose();
      onPick(entry.place);
    }} />;
}
