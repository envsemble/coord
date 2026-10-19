import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { CommandPalette, type CommandPaletteItem } from '@envsemble/envui';
import { DiagramIcon, FileIcon, FolderIcon, LedgerIcon, PlanIcon, SearchIcon } from '../ui/icons';
import type { DiagramIndexEntry, Project, SearchKind, SearchResult, Snapshot, Target } from '../types';
import { api } from '../api';
import { rankItems, type QuickItem } from './quickMatch';
import { hubGroups, hubItems } from '../hub/hubPlans';
import { diagramTarget, fileTarget, workTarget, type Place } from './targets';
import { workNumber } from '../ui/format';
import { hostEntries, listEntries, pathKey, workKey, type SearchDestination, type SearchEntry } from './search';
import { StatusIcon } from '../ui/ui';

interface Entry extends QuickItem, Omit<SearchEntry, 'kind'> { icon: ReactNode }
const localKinds: Record<QuickItem['kind'], SearchKind> = { work: 'plan', diagram: 'diagram', file: 'document' };
const kindIcons: Record<SearchKind, ReactNode> = {
  plan: <PlanIcon />, step: <LedgerIcon />, document: <FileIcon />, heading: <FileIcon />, diagram: <DiagramIcon />, element: <DiagramIcon />, term: <SearchIcon />, project: <FolderIcon />,
};
/** Whether the user moved the highlight off the first result (by key or pointer). */
function highlightMoved() {
  const options = [...document.querySelectorAll('.search-popup [role="option"]')];
  return options.findIndex(option => option.hasAttribute('data-highlighted')) > 0;
}
/** How long typing pauses before the host is asked. */
const searchDelay = 150;

/**
 * The search (Ctrl+P, the title bar's search, the hub's search field): the host's search of every
 * active project of the window's computer, grouped by kind, and what the window finds itself: every
 * plan of the active projects (from the project list), and the diagrams and documents of the open
 * plan's project unless it is archived (`open`, with its snapshot; diagrams are listed as they arrive). The window keeps
 * the query, which the hub's search field types into until the popup takes focus.
 */
export function SearchPopup({ projects, open, query, setQuery, onChoose, onClose }: {
  projects: Project[]; open: { project: string; snapshot: Snapshot } | null; query: string; setQuery(query: string): void; onChoose(destination: SearchDestination): void; onClose(): void;
}) {
  const [diagrams, setDiagrams] = useState<DiagramIndexEntry[]>([]);
  const project = open?.project ?? null;
  useEffect(() => {
    if (!project) return;
    let current = true;
    api.diagramIndex(project).then(items => { if (current) setDiagrams(items); }).catch(() => undefined);
    return () => { current = false; };
  }, [project]);

  // The host's results, asked for once typing pauses, and shown only for the query they answer: an
  // answer that comes after the query changed is dropped. They go first, unless the user has moved
  // the highlight meanwhile (`below`).
  const [found, setFound] = useState<{ query: string; results: SearchResult[]; below: boolean } | null>(null);
  const text = query.trim();
  useEffect(() => {
    if (!text) return;
    let current = true;
    const timer = window.setTimeout(() => {
      const take = (results: SearchResult[]) => { if (current) setFound({ query: text, results, below: highlightMoved() }); };
      api.search(text).then(take, () => take([]));
    }, searchDelay);
    return () => { current = false; window.clearTimeout(timer); };
  }, [text]);

  const entries = useMemo(() => {
    // Every plan of the active projects, in the hub's order; an archived project stays out of the way.
    const all: Entry[] = hubGroups(hubItems(projects, null), 'all').flatMap(group => group.items).map(({ project: owner, work, status }) => ({
      id: owner.folderId + ':work:' + work.id, kind: 'work' as const, label: work.title, detail: owner.name + ' · ' + workNumber(work.id), snippet: null,
      destination: { place: { project: owner.folderId, target: workTarget(work.id) } }, key: workKey(owner.folderId, work.id), icon: <StatusIcon status={status} decorative />,
    }));
    if (open && projects.find(item => item.folderId === open.project)?.state !== 'archived') {
      const { snapshot } = open;
      const place = (target: Target): { place: Place } => ({ place: { project: open.project, target } });
      const titles = new Map(snapshot.work.map(work => [work.id, work.title]));
      const name = projects.find(item => item.folderId === open.project)?.name ?? snapshot.name;
      // A diagram is listed once, by its title; its file is not listed again.
      const paths = new Map(diagrams.map(item => [snapshot.work.find(work => work.id === item.workId)?.path + '/' + item.path, item]));
      all.push(...[...paths].map(([path, item]) => ({
        id: open.project + ':diagram:' + item.workId + ':' + item.path, kind: 'diagram' as const, label: item.title,
        detail: [name, workNumber(item.workId) + ' ' + (titles.get(item.workId) ?? ''), item.provenance.label].filter(Boolean).join(' · '), snippet: null,
        destination: place(diagramTarget(item.workId, item.path)), key: pathKey(open.project, path), icon: <DiagramIcon />,
      })));
      all.push(...snapshot.documents.filter(file => !paths.has(file.path)).map(file => ({
        id: open.project + ':file:' + file.path, kind: 'file' as const, label: file.name, detail: name + ' · ' + file.path, snippet: null,
        destination: place(fileTarget(file.path)), key: pathKey(open.project, file.path), icon: <FileIcon />,
      })));
    }
    return all;
  }, [projects, project, open, diagrams]);
  const icons = useMemo(() => new Map(entries.map(entry => [entry.id, entry.icon])), [entries]);
  const results = useMemo(() => {
    const local = rankItems(entries, query).map(({ icon: _icon, ...entry }) => ({ ...entry, kind: localKinds[entry.kind] }));
    const answered = text && found?.query === text ? found : null;
    return listEntries(local, answered ? hostEntries(answered.results, projects) : [], answered?.below);
  }, [entries, query, text, found, projects]);
  const byId = useMemo(() => new Map(results.map(entry => [entry.id, entry])), [results]);
  // The name read out includes where it is, so many plan.md files stay apart.
  const items: CommandPaletteItem[] = results.map(entry => ({
    id: entry.id, label: entry.label, textValue: [entry.label, entry.detail, entry.snippet].filter(Boolean).join(', '), icon: icons.get(entry.id) ?? kindIcons[entry.kind], group: entry.group,
    detail: entry.snippet ? <><span className="search-where">{entry.detail}</span><span className="search-snippet">{entry.snippet}</span></> : entry.detail,
  }));

  return <CommandPalette open onOpenChange={value => { if (!value) onClose(); }} className="search-popup" aria-label="Search"
    query={query} onQueryChange={setQuery} items={items} placeholder="Search plans, documents, diagrams and projects" emptyLabel={text ? 'No matches' : 'No plans yet'}
    onSelect={item => {
      const entry = byId.get(item.id);
      if (!entry) return;
      onClose();
      onChoose(entry.destination);
    }} />;
}
