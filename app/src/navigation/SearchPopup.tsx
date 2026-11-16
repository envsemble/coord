import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { CommandPalette, type CommandPaletteItem } from '@envsemble/envui';
import { DiagramIcon, FileIcon, FolderIcon, LedgerIcon, PageIcon, PlanIcon, SearchIcon, SettingsIcon, StatisticsIcon, WorkIcon } from '../ui/icons';
import type { DiagramIndexEntry, Project, SearchKind, SearchResult, Snapshot, Target } from '../types';
import { api } from '../api';
import { escapeRegExp, hasWords, rankItems, type QuickItem } from './quickMatch';
import { hubGroups, hubItems } from '../hub/hubPlans';
import { diagramTarget, fileTarget, hubPlace, settingsPlace, statisticsPlace, workTarget, type Place } from './targets';
import { plural, workNumber } from '../ui/format';
import { IconUnfoldMore as MoreIcon } from '@envsemble/envui/icons/UnfoldMore';
import { hostEntries, listEntries, pathKey, workKey, type SearchDestination, type SearchEntry } from './search';
import { StatusIcon } from '../ui/badges';
import { useStars } from '../stars/stars';
import type { HubItem } from '../hub/hubPlans';

interface Entry extends QuickItem, Omit<SearchEntry, 'kind'> { icon: ReactNode; state?: string }
/** The prefixes that narrow the search to a kind (`step: release`), and the kinds each keeps. */
const narrowers: Record<string, SearchKind[]> = {
  plan: ['plan'], step: ['step'], doc: ['document', 'heading', 'page'], diagram: ['diagram', 'element'], term: ['term'], project: ['project'],
};
const kindPrefixes: Partial<Record<SearchKind, string>> = { plan: 'plan', step: 'step', document: 'doc', heading: 'doc', page: 'doc', diagram: 'diagram', element: 'diagram', term: 'term', project: 'project' };
const kindNames: Record<SearchKind, string> = { plan: 'plans', step: 'steps', document: 'documents', heading: 'headings', diagram: 'diagrams', page: 'pages', element: 'elements', term: 'glossary terms', project: 'projects' };
/** A query's narrowing prefix, if it has one, and its words without it. */
function narrowing(text: string): { kinds: SearchKind[] | null; prefix: string | null; words: string } {
  const match = /^(plan|step|doc|diagram|term|project)s?:\s*(.*)$/i.exec(text);
  if (match) return { kinds: narrowers[match[1]!.toLowerCase()]!, prefix: match[1]!.toLowerCase(), words: match[2]!.trim() };
  // tag: is the host's own: what it finds are plans, which the window does not rank itself.
  return { kinds: null, prefix: null, words: text.toLowerCase().startsWith('tag:') ? '' : text };
}
/** What the host is asked: the words without a narrowing prefix, tag: and all. */
const searched = (text: string) => { const { prefix, words } = narrowing(text); return prefix ? words : text; };
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
/** Where a plan is, on the line under its title: its project and its number. Its state goes at the row's end. */
const planWhere = ({ project, work }: Pick<HubItem, 'project' | 'work'>) => project.name + ' \u00b7 ' + workNumber(work.id);
const localKinds: Record<QuickItem['kind'], SearchKind> = { work: 'plan', diagram: 'diagram', file: 'document' };
const kindIcons: Record<SearchKind, ReactNode> = {
  plan: <PlanIcon />, step: <LedgerIcon />, document: <FileIcon />, heading: <FileIcon />, diagram: <DiagramIcon />, page: <PageIcon />, element: <DiagramIcon />, term: <SearchIcon />, project: <FolderIcon />,
};
/** A place opened from the search, remembered by main for the window's computer to show under Recent. */
interface Recent { id: string; kind: SearchKind; label: string; detail: string; destination: SearchDestination; key: string | null; plan: string | null }
/** The last Recent each computer's search had in this window, shown at once while main is asked again. */
const lastRecent = new Map<string, Recent[]>();
function readRecent(json: string): Recent[] {
  try {
    const value = JSON.parse(json) as unknown;
    return Array.isArray(value) ? value.filter((each): each is Recent => Boolean(each && typeof each.id === 'string' && typeof each.label === 'string' && each.destination)).slice(0, 5) : [];
  } catch { return []; }
}
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
export function SearchPopup({ hostId, projects, open, query, setQuery, onChoose, onClose }: {
  hostId: string | null; projects: Project[]; open: { projectId: string; snapshot: Snapshot } | null; query: string; setQuery(query: string): void; onChoose(destination: SearchDestination): void; onClose(): void;
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
  const asked = searched(text);
  useEffect(() => {
    if (!asked) return;
    let current = true;
    const timer = window.setTimeout(() => {
      const take = (results: SearchResult[]) => { if (current) setFound({ query: asked, results, below: highlightMoved() }); };
      api.search(asked).then(take, () => take([]));
    }, searchDelay);
    return () => { current = false; window.clearTimeout(timer); };
  }, [asked]);

  const entries = useMemo(() => {
    // Every plan of the active projects, in the hub's order; an archived project stays out of the way.
    const all: Entry[] = hubGroups(hubItems(projects, null), 'all').flatMap(group => group.items).map(({ project: owner, work, status }) => ({
      id: owner.id + ':work:' + work.id, kind: 'work' as const, label: work.title, detail: planWhere({ project: owner, work }), state: status.label, snippet: null, penalty: work.state === 'closed' ? 6 : 0,
      destination: { place: { projectId: owner.id, target: workTarget(work.id) } }, key: workKey(owner.id, work.id), plan: workKey(owner.id, work.id), icon: <StatusIcon status={status} decorative />,
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
        destination: place(diagramTarget(item.workId, item.path)), key: pathKey(open.projectId, path), plan: workKey(open.projectId, item.workId), icon: <DiagramIcon />,
      })));
      all.push(...snapshot.documents.filter(file => !paths.has(file.path)).map(file => ({
        id: open.projectId + ':file:' + file.path, kind: 'file' as const, label: file.name, detail: name + ' · ' + file.path, snippet: null,
        destination: place(fileTarget(file.path)), key: pathKey(open.projectId, file.path), icon: <FileIcon />,
      })));
    }
    return all;
  }, [projects, projectId, open, diagrams]);
  const icons = useMemo(() => new Map(entries.map(entry => [entry.id, entry.icon])), [entries]);
  // Each plan by its key: its look, for the plans the host's search returns, and whether it is closed,
  // so the steps and documents of closed plans go below those of open ones.
  const plans = useMemo(() => new Map(entries.filter(entry => entry.kind === 'work' && entry.key).map(entry => [entry.key!, entry])), [entries]);
  const { kinds, prefix, words } = narrowing(text);
  const tagged = text.toLowerCase().startsWith('tag:') ? text.slice(4).trim().split(/\s+/)[0] || null : null;
  const results = useMemo(() => {
    if (!words && !tagged) return [];
    // A tag: search is the host's alone: the window does not know which plans a tag's words match.
    const local = tagged ? [] : kinds ? entries.filter(entry => kinds.includes(localKinds[entry.kind])) : entries;
    const ranked = rankItems(local, words).map(({ icon: _icon, penalty: _penalty, state: _state, ...entry }) => ({ ...entry, kind: localKinds[entry.kind] }));
    const answered = asked && found?.query === asked ? found : null;
    const host = answered ? hostEntries(answered.results, projects).filter(entry => !kinds || kinds.includes(entry.kind)) : [];
    let listed = listEntries(ranked, host, answered?.below)
      // A plan the host found reads as the window lists it: its project and number; a tag: search's
      // plans are headed by the tag.
      .map(entry => entry.kind === 'plan' && entry.key && plans.get(entry.key) ? { ...entry, detail: plans.get(entry.key)!.detail } : entry)
      .map(entry => tagged && entry.kind === 'plan' ? { ...entry, group: 'Plans tagged ' + tagged } : entry);
    // A plan's ledger found where one of its steps is found too says nothing more than the step.
    const stepped = new Set(listed.filter(entry => entry.kind === 'step' && entry.plan).map(entry => entry.plan));
    listed = listed.filter(entry => !(entry.kind === 'document' && entry.label.startsWith('Steps of ') && entry.plan && stepped.has(entry.plan)));
    const closed = (entry: SearchEntry) => Boolean(entry.plan && plans.get(entry.plan)?.penalty);
    const inTitle = (entry: SearchEntry) => hasWords(entry.label, words);
    const whole = (entry: SearchEntry) => hasWords([entry.label, entry.detail, entry.snippet].filter(Boolean).join(' '), words);
    // In each group: those with the words where words start (not only inside other words, "sign" in
    // "design"); those of open plans first, then those whose title has the words, in the order found;
    // at most three found only in the text when others have them in the title.
    const groups = [...new Set(listed.map(entry => entry.group))].map(group => {
      const found = listed.filter(entry => entry.group === group);
      const members = found.some(whole) ? found.filter(whole) : found;
      const ordered = [...members].sort((a, b) => Number(closed(a)) - Number(closed(b)) || Number(inTitle(b)) - Number(inTitle(a)));
      const titled = ordered.filter(inTitle).length;
      let textOnly = 0;
      return { group, members: ordered.filter(entry => inTitle(entry) || !titled || ++textOnly <= 3) };
    });
    // Narrowed to a kind, its results all show; otherwise a few of each, so every kind found is in view,
    // and a group cut short ends with a row that narrows the search to its kind.
    // A tag's plans all show; a group is folded only when that hides more than one result.
    const cap = kinds || tagged ? 50 : groups.length > 1 ? 4 : 8;
    return groups.flatMap(({ group, members }) => {
      const shown = members.length <= cap + 1 ? members : members.slice(0, cap);
      const more = members.length - shown.length;
      const kind = members[0]!.kind;
      return more > 0 && kindPrefixes[kind] ? [...shown, { id: 'more:' + kindPrefixes[kind] + ':' + group, kind, label: 'Show all ' + members.length + ' ' + kindNames[kind], detail: '', snippet: null, destination: shown[0]!.destination, key: null, group, more: true }] : shown;
    });
  }, [entries, words, kinds, tagged, asked, found, projects, plans]);
  const byId = useMemo(() => new Map(results.map(entry => [entry.id, entry])), [results]);
  const item = (entry: { id: string; label: string; detail: string; snippet?: string | null; group: string; icon: ReactNode; state?: string | null }): CommandPaletteItem => ({
    // One line of title: a long one ends in an ellipsis, so more results fit in view.
    id: entry.id, label: <span className="search-label" title={entry.label}>{marked(entry.label, words)}</span>, textValue: [entry.label, entry.state, entry.detail, entry.snippet].filter(Boolean).join(', '), icon: entry.icon, group: entry.group,
    // One line of where it is; the words it was found in under it, marked, only when the search found it in its text.
    description: entry.detail || entry.snippet ? <><span className="search-where">{entry.detail}</span>{entry.snippet && <span className="search-snippet">{marked(entry.snippet, words)}</span>}</> : undefined,
    // A plan's state at the row's end, where it does not crowd where the plan is.
    end: entry.state ? <span className="search-state">{entry.state}</span> : undefined,
  });
  const goTo = pages.filter(page => words && !kinds && rankItems([{ id: page.id, kind: 'work', label: page.label, detail: 'Go to' }], words).length);
  const items: CommandPaletteItem[] = [
    ...results.map(entry => 'more' in entry
      ? { id: entry.id, label: entry.label, textValue: entry.label, icon: <MoreIcon />, group: entry.group, className: 'search-more' }
      // A plan says its state at its end; its steps, documents and diagrams say it only when the plan is
      // closed, where it tells something: the open ones come first already.
      : item({ ...entry,
        icon: icons.get(entry.id) ?? (entry.key && plans.get(entry.key)?.icon) ?? kindIcons[entry.kind], state: entry.kind === 'plan' ? (entry.key ? plans.get(entry.key)?.state : null) : entry.plan && plans.get(entry.plan)?.penalty ? plans.get(entry.plan)?.state : null })),
    ...goTo.map(page => ({ id: page.id, label: page.label, textValue: 'Go to ' + page.label, icon: page.icon, group: 'Go to' })),
  ];

  // A prefix's values, as it is typed (tag:, tag:0.9, project:): the user's tags, the most used first,
  // and their projects, so the prefixes the tip shows lead somewhere at once.
  const picking = /^(tag|project):(\S*)$/i.exec(text);
  const values: CommandPaletteItem[] = useMemo(() => {
    if (!picking) return [];
    const part = picking[2]!.toLowerCase();
    if (picking[1]!.toLowerCase() === 'project') return projects.filter(each => each.state === 'active' && hasWords(each.name, part || each.name))
      .map(each => ({ id: 'project:' + each.id, label: each.name, textValue: each.name, icon: <FolderIcon />, group: 'Projects', end: <span className="search-state">{plural(hubItems([each], each.id).filter(plan => plan.work.state !== 'closed').length, 'open plan')}</span> }));
    const counts = new Map<string, number>();
    for (const plan of hubItems(projects, null)) for (const tag of plan.work.tags ?? []) counts.set(tag, (counts.get(tag) ?? 0) + 1);
    return [...counts].filter(([tag]) => tag.toLowerCase().startsWith(part)).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).slice(0, 12)
      .map(([tag, count]) => ({ id: 'tag:' + tag, label: <code className="search-try">tag:{tag}</code>, textValue: 'tag ' + tag, icon: <SearchIcon />, group: 'Tags', end: <span className="search-state">{plural(count, 'plan')}</span> }));
  }, [picking?.[0], projects]);
  const shownItems = [...values.filter(value => value.id !== 'tag:' + tagged), ...items];
  // A prefix with nothing after it says what to type, not that nothing matched.
  const waiting = prefix && !words && !picking ? 'Type words to find ' + kindNames[narrowers[prefix]![0]!] : null;

  // The places opened from the search lately on the window's computer, the newest first, the same in
  // every window and kept by main for the next time.
  const computer = hostId ?? 'local';
  const [recent, setRecent] = useState<Recent[]>(() => lastRecent.get(computer) ?? []);
  useEffect(() => {
    let current = true;
    api.recentSearches(computer).then(json => { const read = readRecent(json); lastRecent.set(computer, read); if (current) setRecent(read); }, () => undefined);
    return () => { current = false; };
  }, [computer]);
  const remember = (entry: Recent) => {
    const next = [entry, ...recent.filter(each => each.id !== entry.id)].slice(0, 5);
    setRecent(next);
    lastRecent.set(computer, next);
    api.rememberSearches(computer, JSON.stringify(next)).catch(() => undefined);
  };

  // What the search can find, shown to someone who has not used it yet: four searches to try, made
  // from their own plans, each typed into the field when chosen. A tag (the one most plans have), a
  // plan by its number, the steps about a word of a step under way, and a project by its name.
  const tries = useMemo(() => {
    const plans = hubItems(projects, null);
    const counts = new Map<string, number>();
    for (const plan of plans) for (const tag of plan.work.tags ?? []) counts.set(tag, (counts.get(tag) ?? 0) + 1);
    const tag = [...counts].sort((a, b) => b[1] - a[1])[0];
    const open = hubGroups(plans, 'open').flatMap(group => group.items);
    const numbered = open[0];
    const stepped = open.find(plan => plan.work.step);
    const word = stepped?.work.step?.title.split(/[^\p{L}\p{N}-]+/u).filter(each => each.length >= 5).sort((a, b) => b.length - a.length)[0]?.toLowerCase();
    const project = projects.find(each => each.state === 'active' && each.id !== numbered?.project.id) ?? projects.find(each => each.state === 'active');
    return [
      tag && { query: 'tag:' + tag[0], finds: 'Plans tagged ' + tag[0] + ', ' + plural(tag[1], 'plan') },
      numbered && { query: workNumber(numbered.work.id), finds: 'A plan by its number: ' + numbered.work.title },
      word && { query: 'step: ' + word, finds: 'Steps about ' + word },
      project && { query: project.name, finds: 'A project, to see its plans' },
    ].filter((example): example is { query: string; finds: string } => Boolean(example));
  }, [projects]);

  // Before typing: what is worth coming back to, and how to search. The starred plans, the places
  // opened from the search lately, searches to try, the plans that are the user's turn (the most
  // recently changed first), and the pages to go to.
  const { starred } = useStars();
  const suggestions = useMemo(() => {
    const all = hubItems(projects, null);
    const shown = new Set<string>();
    const take = (list: HubItem[], group: string, limit: number) => list.filter(plan => !shown.has(workKey(plan.project.id, plan.work.id))).slice(0, limit).map(plan => {
      shown.add(workKey(plan.project.id, plan.work.id));
      // The state is said by the group's heading where it is the group's.
      return item({ id: 'suggested:' + group + ':' + plan.project.id + ':' + plan.work.id, label: plan.work.title, detail: planWhere(plan), group, icon: <StatusIcon status={plan.status} decorative />, state: plan.status.label === group ? null : plan.status.label });
    });
    const starredPlans = take(all.filter(plan => starred(plan.project.id, plan.work.id)), 'Starred', 6);
    const tryItems = tries.map(example => ({ id: 'try:' + example.query, label: <code className="search-try">{example.query}</code>, textValue: example.query + ', ' + example.finds, description: example.finds, icon: <SearchIcon />, group: 'Try' }));
    // What was opened lately, as it is now: a plan with its state; one no longer listed is left out.
    // A starred plan opened lately is in both: Recent is about when, Starred about what.
    const lately = recent.filter(each => each.kind !== 'plan' || (each.key && plans.has(each.key))).map(each => {
      if (each.key) shown.add(each.key);
      const plan = each.key ? plans.get(each.key) : undefined;
      return item({ id: 'recent:' + each.id, label: each.label, detail: each.detail, group: 'Recent', icon: plan?.icon ?? kindIcons[each.kind], state: (each.plan && plans.get(each.plan)?.state) ?? plan?.state ?? null });
    });
    return [
      ...starredPlans,
      ...lately,
      // The searches to try come before Your turn for someone new to the search, after it once they
      // have opened a few places from it.
      ...(lately.length >= 3 ? [] : tryItems),
      ...take(hubGroups(all, 'open').find(group => group.id === 'your_turn')?.items ?? [], 'Your turn', 3),
      ...(lately.length >= 3 ? tryItems : []),
      ...pages.map(page => ({ id: page.id, label: page.label, textValue: 'Go to ' + page.label, icon: page.icon, group: 'Go to' })),
    ];
  }, [projects, starred, tries, recent, plans]);
  const suggested = useMemo(() => new Map(hubItems(projects, null).map(plan => [plan.project.id + ':' + plan.work.id, plan])), [projects]);

  return <CommandPalette open onOpenChange={value => { if (!value) onClose(); }} className="search-popup" aria-label="Search" closeOnAction={false}
    inputValue={query} onInputValueChange={setQuery} items={shownItems} suggestedItems={suggestions} placeholder="Search everything, or narrow with tag:, step:, doc:…"
    hints={[{ keys: ['Enter'], label: 'Open' }, { keys: ['Esc'], label: 'Close' }]}
    // While the host is asked, the field says so, and "No matches" waits for its answer.
    loading={Boolean(asked) && !waiting && found?.query !== asked}
    emptyLabel={waiting ?? (text ? 'No matches' : 'No plans yet')} emptyDescription={waiting ? 'Such as ' + prefix + ': ' + (prefix === 'project' ? 'coord' : 'release') : text ? 'Try fewer words, or narrow with step: or doc:' : undefined}
    footer={<span className="search-tip">Narrow with <code className="search-try">tag:</code> <code className="search-try">step:</code> <code className="search-try">doc:</code> <code className="search-try">diagram:</code> <code className="search-try">term:</code> <code className="search-try">project:</code><span className="search-tip-gap" aria-hidden="true" /><code className="search-try">#0031</code> opens a plan</span>}
    onAction={chosen => {
      // A search to try is typed into the field, and a group's Show all narrows the search to its kind;
      // the search stays open on what they find.
      if (chosen.id.startsWith('try:')) { setQuery(chosen.id.slice(4)); return; }
      if (chosen.id.startsWith('more:')) { setQuery(chosen.id.split(':')[1] + ': ' + words); return; }
      // A tag is typed in, to see its plans; a project opens its plans.
      if (chosen.id.startsWith('tag:')) { setQuery(chosen.id); return; }
      if (chosen.id.startsWith('project:')) { onClose(); onChoose({ place: hubPlace(chosen.id.slice(8)) }); return; }
      const page = pages.find(each => each.id === chosen.id);
      const plan = chosen.id.startsWith('suggested:') ? suggested.get(chosen.id.split(':').slice(2).join(':')) : undefined;
      const again = chosen.id.startsWith('recent:') ? recent.find(each => 'recent:' + each.id === chosen.id) : undefined;
      const result = byId.get(chosen.id);
      const destination = page ? { place: page.place } : plan ? { place: { projectId: plan.project.id, target: workTarget(plan.work.id) } } : again?.destination ?? result?.destination;
      if (!destination) return;
      // What was opened is remembered for the next time the search opens, under Recent.
      if (plan) remember({ id: workKey(plan.project.id, plan.work.id), kind: 'plan', label: plan.work.title, detail: planWhere(plan), destination, key: workKey(plan.project.id, plan.work.id), plan: workKey(plan.project.id, plan.work.id) });
      else if (again) remember(again);
      else if (result && !('more' in result)) remember({ id: result.key ?? result.kind + ':' + JSON.stringify(destination), kind: result.kind, label: result.label, detail: result.detail, destination, key: result.key, plan: result.plan ?? null });
      onClose();
      onChoose(destination);
    }} />;
}
