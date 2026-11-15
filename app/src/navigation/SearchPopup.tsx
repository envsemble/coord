import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { CommandPalette, type CommandPaletteItem } from '@envsemble/envui';
import { DiagramIcon, FileIcon, FolderIcon, LedgerIcon, PageIcon, PlanIcon, SearchIcon, SettingsIcon, StatisticsIcon, WorkIcon } from '../ui/icons';
import type { DiagramIndexEntry, Project, SearchKind, SearchResult, Snapshot, Target } from '../types';
import { api } from '../api';
import { escapeRegExp, hasWords, rankItems, type QuickItem } from './quickMatch';
import { hubGroups, hubItems } from '../hub/hubPlans';
import { diagramTarget, fileTarget, hubPlace, settingsPlace, statisticsPlace, workTarget, type Place } from './targets';
import { workNumber } from '../ui/format';
import { hostEntries, listEntries, pathKey, workKey, type SearchDestination, type SearchEntry } from './search';
import { StatusIcon } from '../ui/badges';
import { useStars } from '../stars/stars';
import type { HubItem } from '../hub/hubPlans';

interface Entry extends QuickItem, Omit<SearchEntry, 'kind'> { icon: ReactNode }
/** How many results of a kind show while typing: enough to choose from, few enough to take in at a glance. */
const perGroup = 8;
/** The pages to go to, as results like any other: they show while the field is empty, and match what is typed. */
const pages: { id: string; label: string; icon: ReactNode; place: Place }[] = [
  { id: 'go:plans', label: 'Plans', icon: <WorkIcon />, place: hubPlace() },
  { id: 'go:statistics', label: 'Statistics', icon: <StatisticsIcon />, place: statisticsPlace(null) },
  { id: 'go:settings', label: 'Settings', icon: <SettingsIcon />, place: settingsPlace() },
];
/** The text with the query's words marked where they are, so a result shows why it was found. */
function marked(text: string, query: string): ReactNode {
  // Words of one or two letters (in, to) would mark half the text; they still count in matching.
  const words = query.trim().split(/\s+/).filter(word => word.length > 2).map(escapeRegExp);
  if (!words.length) return text;
  // Only where a word starts, as the search matches: "sign" in "sign-in", not in "design".
  const parts = text.split(new RegExp('(?<![\\p{L}\\p{N}])(' + words.join('|') + ')', 'giu'));
  return parts.map((part, index) => index % 2 ? <mark key={index} className="search-mark">{part}</mark> : part);
}
/** A plan's one line under its title: its project, its number, and its state. */
const planMeta = ({ project, work, status }: HubItem) => [project.name, workNumber(work.id), status.label].join(' \u00b7 ');
const localKinds: Record<QuickItem['kind'], SearchKind> = { work: 'plan', diagram: 'diagram', file: 'document' };
const kindIcons: Record<SearchKind, ReactNode> = {
  plan: <PlanIcon />, step: <LedgerIcon />, document: <FileIcon />, heading: <FileIcon />, diagram: <DiagramIcon />, page: <PageIcon />, element: <DiagramIcon />, term: <SearchIcon />, project: <FolderIcon />,
};
/** Whether the user moved the highlight off the first result (by key or pointer). */
function highlightMoved() {
  const options = [...document.querySelectorAll('.search-popup [role="option"]')];
  return options.findIndex(option => option.hasAttribute('data-highlighted')) > 0;
}
/** How long typing pauses before the host is asked. */
const searchDelay = 150;

/**
 * The search (Ctrl+K or Ctrl+P, the title bar's search): the host's search of every
 * active project of the window's computer, grouped by kind, and what the window finds itself: every
 * plan of the active projects (from the project list), and the diagrams and documents of the open
 * plan's project unless it is archived (`open`, with its snapshot; diagrams are listed as they arrive). The window keeps
 * the query, which the hub's search field types into until the popup takes focus.
 */
export function SearchPopup({ projects, open, query, setQuery, onChoose, onClose }: {
  projects: Project[]; open: { projectId: string; snapshot: Snapshot } | null; query: string; setQuery(query: string): void; onChoose(destination: SearchDestination): void; onClose(): void;
}) {
  const [diagrams, setDiagrams] = useState<DiagramIndexEntry[]>([]);
  const projectId = open?.projectId ?? null;
  useEffect(() => {
    if (!projectId) return;
    let current = true;
    api.diagramIndex(projectId).then(items => { if (current) setDiagrams(items); }).catch(() => undefined);
    return () => { current = false; };
  }, [projectId]);

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
      id: owner.id + ':work:' + work.id, kind: 'work' as const, label: work.title, detail: planMeta({ project: owner, work, status }), snippet: null, penalty: work.state === 'closed' ? 6 : 0,
      destination: { place: { projectId: owner.id, target: workTarget(work.id) } }, key: workKey(owner.id, work.id), icon: <StatusIcon status={status} decorative />,
    }));
    if (open && projects.find(item => item.id === open.projectId)?.state !== 'archived') {
      const { snapshot } = open;
      const place = (target: Target): { place: Place } => ({ place: { projectId: open.projectId, target } });
      const titles = new Map(snapshot.work.map(work => [work.id, work.title]));
      const name = projects.find(item => item.id === open.projectId)?.name ?? snapshot.name;
      // A diagram is listed once, by its title; its file is not listed again.
      const paths = new Map(diagrams.map(item => [snapshot.work.find(work => work.id === item.workId)?.path + '/' + item.path, item]));
      all.push(...[...paths].map(([path, item]) => ({
        id: open.projectId + ':diagram:' + item.workId + ':' + item.path, kind: 'diagram' as const, label: item.title,
        detail: [name, workNumber(item.workId) + ' ' + (titles.get(item.workId) ?? ''), item.provenance.label].filter(Boolean).join(' · '), snippet: null,
        destination: place(diagramTarget(item.workId, item.path)), key: pathKey(open.projectId, path), icon: <DiagramIcon />,
      })));
      all.push(...snapshot.documents.filter(file => !paths.has(file.path)).map(file => ({
        id: open.projectId + ':file:' + file.path, kind: 'file' as const, label: file.name, detail: name + ' · ' + file.path, snippet: null,
        destination: place(fileTarget(file.path)), key: pathKey(open.projectId, file.path), icon: <FileIcon />,
      })));
    }
    return all;
  }, [projects, projectId, open, diagrams]);
  const icons = useMemo(() => new Map(entries.map(entry => [entry.id, entry.icon])), [entries]);
  // Each plan's look by its key, for the plans the host's search returns.
  const plans = useMemo(() => new Map(entries.filter(entry => entry.kind === 'work' && entry.key).map(entry => [entry.key!, entry])), [entries]);
  const results = useMemo(() => {
    const local = rankItems(entries, query).map(({ icon: _icon, penalty: _penalty, ...entry }) => ({ ...entry, kind: localKinds[entry.kind] }));
    const answered = text && found?.query === text ? found : null;
    // At most `perGroup` of each group, so every kind found shows near the top.
    const counts = new Map<string, number>();
    const listed = listEntries(local, answered ? hostEntries(answered.results, projects) : [], answered?.below)
      // A plan the host found reads as the window lists it: its project, number and state.
      .map(entry => entry.kind === 'plan' && entry.key && plans.get(entry.key) ? { ...entry, detail: plans.get(entry.key)!.detail } : entry);
    // In each group, those whose title has every word typed come first, in the order they were found;
    // when some have the words where words start, those that have them only inside other words
    // ("sign" in "design") are left out.
    const groups = [...new Set(listed.map(entry => entry.group))];
    const whole = (entry: SearchEntry) => hasWords([entry.label, entry.detail, entry.snippet].filter(Boolean).join(' '), text);
    return groups.flatMap(group => {
      const found = listed.filter(entry => entry.group === group);
      const members = found.some(whole) ? found.filter(whole) : found;
      return [...members.filter(entry => hasWords(entry.label, text)), ...members.filter(entry => !hasWords(entry.label, text))];
    }).filter(entry => {
      const count = (counts.get(entry.group) ?? 0) + 1;
      counts.set(entry.group, count);
      return count <= perGroup;
    });
  }, [entries, query, text, found, projects, plans]);
  const byId = useMemo(() => new Map(results.map(entry => [entry.id, entry])), [results]);
  const item = (entry: { id: string; label: string; detail: string; snippet?: string | null; group: string; icon: ReactNode }): CommandPaletteItem => ({
    id: entry.id, label: marked(entry.label, text), textValue: [entry.label, entry.detail, entry.snippet].filter(Boolean).join(', '), icon: entry.icon, group: entry.group,
    // One line of where it is; the words it was found in under it, marked, only when the search found it in its text.
    description: <><span className="search-where">{entry.detail}</span>{entry.snippet && <span className="search-snippet">{marked(entry.snippet, text)}</span>}</>,
  });
  const goTo = pages.filter(page => text && rankItems([{ id: page.id, kind: 'work', label: page.label, detail: 'Go to' }], text).length);
  const items: CommandPaletteItem[] = [
    ...results.map(entry => item({ ...entry, icon: icons.get(entry.id) ?? (entry.key && plans.get(entry.key)?.icon) ?? kindIcons[entry.kind] })),
    ...goTo.map(page => ({ id: page.id, label: page.label, textValue: 'Go to ' + page.label, icon: page.icon, group: 'Go to' })),
  ];

  // What the search can find, shown to someone who has not used it yet: searches to try, made from
  // their own plans, each typed into the field when chosen. A tag (the one most plans have), a plan
  // by its number, and a diagram of the plan shown by its name.
  const tries = useMemo(() => {
    const plans = hubItems(projects, null);
    const counts = new Map<string, number>();
    for (const plan of plans) for (const tag of plan.work.tags ?? []) counts.set(tag, (counts.get(tag) ?? 0) + 1);
    const tag = [...counts].sort((a, b) => b[1] - a[1])[0]?.[0];
    const numbered = hubGroups(plans, 'open')[0]?.items[0];
    const diagram = diagrams[0];
    return [
      tag && { query: 'tag:' + tag, finds: 'Every plan tagged ' + tag },
      numbered && { query: workNumber(numbered.work.id), finds: 'A plan by its number: ' + numbered.work.title },
      diagram && { query: diagram.title, finds: 'Diagrams, and their classes and tables, by name; steps, documents and glossary terms too' },
    ].filter((example): example is { query: string; finds: string } => Boolean(example));
  }, [projects, diagrams]);

  // Before typing: what is worth coming back to. The starred plans, those that are the user's turn
  // (the longest waiting first), the open ones changed most recently, and the pages to go to; then
  // searches to try.
  const { starred } = useStars();
  const suggestions = useMemo(() => {
    const plans = hubItems(projects, null);
    const shown = new Set<string>();
    const take = (list: HubItem[], group: string, limit: number) => list.filter(plan => !shown.has(plan.project.id + ':' + plan.work.id)).slice(0, limit).map(plan => {
      shown.add(plan.project.id + ':' + plan.work.id);
      return item({ id: 'suggested:' + group + ':' + plan.project.id + ':' + plan.work.id, label: plan.work.title, detail: planMeta(plan), group, icon: <StatusIcon status={plan.status} decorative /> });
    });
    const open = hubGroups(plans, 'open');
    const recent = plans.filter(plan => plan.work.state !== 'closed').sort((a, b) => (b.work.updated ?? '').localeCompare(a.work.updated ?? ''));
    return [
      ...take(plans.filter(plan => starred(plan.project.id, plan.work.id)), 'Starred', 8),
      ...take(open.find(group => group.id === 'your_turn')?.items ?? [], 'Your turn', 5),
      ...take(recent, 'Recently changed', 5),
      ...pages.map(page => ({ id: page.id, label: page.label, textValue: 'Go to ' + page.label, icon: page.icon, group: 'Go to' })),
      ...tries.map(example => ({ id: 'try:' + example.query, label: <code className="search-try">{example.query}</code>, textValue: example.query + ', ' + example.finds, description: example.finds, icon: <SearchIcon />, group: 'Try' })),
    ];
  }, [projects, starred, tries]);
  const suggested = useMemo(() => new Map(hubItems(projects, null).map(plan => [plan.project.id + ':' + plan.work.id, plan])), [projects]);

  return <CommandPalette open onOpenChange={value => { if (!value) onClose(); }} className="search-popup" aria-label="Search" closeOnAction={false}
    inputValue={query} onInputValueChange={setQuery} items={items} suggestedItems={suggestions} placeholder="Search plans, steps, documents and diagrams, or tag:…"
    hints={[{ keys: ['Enter'], label: 'Open' }, { keys: ['Esc'], label: 'Close' }]} emptyLabel={text ? 'No matches' : 'No plans yet'}
    onAction={chosen => {
      // A search to try is typed into the field, and the search stays open on what it finds.
      if (chosen.id.startsWith('try:')) { setQuery(chosen.id.slice(4)); return; }
      const page = pages.find(each => each.id === chosen.id);
      const plan = chosen.id.startsWith('suggested:') ? suggested.get(chosen.id.split(':').slice(2).join(':')) : undefined;
      const destination = page ? { place: page.place } : plan ? { place: { projectId: plan.project.id, target: workTarget(plan.work.id) } } : byId.get(chosen.id)?.destination;
      if (!destination) return;
      onClose();
      onChoose(destination);
    }} />;
}
