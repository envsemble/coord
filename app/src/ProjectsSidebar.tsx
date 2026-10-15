// The sidebar's projects: those of the computer the window shows, in their order, as cards that each
// open the project's page, below a strip with a search over them and New Project; hidden and archived
// projects wait in a group below the cards, closed until opened. A project's context menu renames
// it, moves it, and hides, archives or shows it again; projects are never deleted here. A project
// outside the Atlas home (from before it) is marked, and its menu moves it into the home. While the
// sidebar shows icons only, each project is an icon.
import { useState, type ReactNode } from 'react';
import { Button, Card, ContextMenu, Dialog, IconButton, Input, MenuItem, MenuSeparator, NavigationItem, Notice, SearchField, Spinner, Text, Tooltip, useSidebarCompact } from '@envsemble/envui';
import { AddIcon, ArchiveIcon, CloseIcon, FolderIcon } from './icons';
import type { Project, ProjectRepository, ProjectState } from './types';
import { api } from './api';

export interface ProjectActions {
  /** Show a project's page. */
  open(project: Project): void;
  update(project: Project, change: { name?: string; state?: ProjectState; position?: number }): void;
  rename(project: Project): void;
  /** Move a project outside the Atlas home into it. */
  adopt(project: Project): void;
  create(): void;
}

const stateLabels: Record<ProjectState, string> = { active: 'Active', hidden: 'Hidden', archived: 'Archived' };
const projectIcon = (project: Project) => project.state === 'archived' ? <ArchiveIcon /> : <FolderIcon />;
const projectTitle = (project: Project) => project.path + (project.outsideHome ? ' (outside the Atlas home: agents do not find it until it is moved in)' : '');
/** What a card says below the name: where the project stands, when that is not simply active in the home. */
const projectNote = (project: Project) => [project.outsideHome && 'Outside the Atlas home', project.state !== 'active' && stateLabels[project.state]].filter(Boolean).join(' · ');

/** One project as a card: it opens its page; its context menu is the list's. */
function ProjectCard({ project, selected, actions }: { project: Project; selected: boolean; actions: ProjectActions }) {
  const note = projectNote(project);
  return <Card as="button" type="button" className="project-card" data-project={project.folderId} data-state={project.state} aria-current={selected ? 'page' : undefined}
    title={projectTitle(project)} onClick={() => actions.open(project)}>
    <span className="project-card-icon" aria-hidden="true">{projectIcon(project)}</span>
    <span className="project-card-text">
      <span className="project-card-name">{project.name}</span>
      {note && <span className="project-card-note">{note}</span>}
    </span>
  </Card>;
}

/** The project a context menu was opened on, by the element it was opened on. */
const projectAt = (projects: Project[], target: Element | null) => {
  const folderId = target?.closest('[data-project]')?.getAttribute('data-project');
  return projects.find(project => project.folderId === folderId) ?? null;
};

function ProjectMenu({ project, projects, actions }: { project: Project | null; projects: Project[]; actions: ProjectActions }) {
  if (!project) return <MenuItem icon={<AddIcon />} onClick={actions.create}>New Project…</MenuItem>;
  const peers = projects.filter(other => (other.state === 'active') === (project.state === 'active'));
  const index = peers.indexOf(project);
  // Moving within the group swaps with the neighbour there; positions are in the computer's whole order.
  const move = (by: -1 | 1) => { const neighbour = peers[index + by]; if (neighbour) actions.update(project, { position: neighbour.position }); };
  return <>
    <MenuItem onClick={() => actions.open(project)}>Open</MenuItem>
    <MenuItem onClick={() => actions.rename(project)}>Rename…</MenuItem>
    {project.outsideHome && <MenuItem onClick={() => actions.adopt(project)}>Move into the Atlas home</MenuItem>}
    <MenuSeparator />
    <MenuItem disabled={index <= 0} onClick={() => move(-1)}>Move Up</MenuItem>
    <MenuItem disabled={index < 0 || index >= peers.length - 1} onClick={() => move(1)}>Move Down</MenuItem>
    <MenuSeparator />
    {project.state !== 'active' && <MenuItem onClick={() => actions.update(project, { state: 'active' })}>{project.state === 'archived' ? 'Restore' : 'Show'}</MenuItem>}
    {project.state !== 'hidden' && <MenuItem onClick={() => actions.update(project, { state: 'hidden' })}>Hide</MenuItem>}
    {project.state !== 'archived' && <MenuItem onClick={() => actions.update(project, { state: 'archived' })}>Archive</MenuItem>}
  </>;
}

/** Whether a project matches the search: every word in its name or folder, ignoring case. */
export const projectMatches = (project: Project, query: string) => {
  const text = (project.name + ' ' + project.path).toLocaleLowerCase();
  return query.toLocaleLowerCase().split(/\s+/).filter(Boolean).every(word => text.includes(word));
};

/**
 * The top of the sidebar: a strip with the search over the projects and New Project; while the
 * sidebar shows icons only, each active project as an icon instead, then New Project.
 */
export function ProjectsNavigation({ projects, query, onQueryChange, selected, actions }: {
  projects: Project[] | null; query: string; onQueryChange(query: string): void; selected: string | null; actions: ProjectActions;
}) {
  const compact = useSidebarCompact();
  const all = projects ?? [];
  if (compact) return <ContextMenu aria-label="Project actions" density="compact" content={target => <ProjectMenu project={projectAt(all, target)} projects={all} actions={actions} />}>
    <div className="project-icons" role="group" aria-label="Projects">
      {all.filter(project => project.state === 'active').map(project => <NavigationItem key={project.folderId} icon={projectIcon(project)} selected={selected === project.folderId}
        data-project={project.folderId} title={projectTitle(project)} onClick={() => actions.open(project)}>{project.name}</NavigationItem>)}
      <NavigationItem icon={<AddIcon />} onClick={actions.create}>New Project…</NavigationItem>
    </div>
  </ContextMenu>;
  return <div className="project-strip">
    <SearchField className="project-search" label="Search projects" placeholder="Search projects" value={query} onValueChange={onQueryChange} />
    <Tooltip content="New project" side="bottom"><IconButton variant="text" icon={<AddIcon />} aria-label="New project" onClick={actions.create} /></Tooltip>
  </div>;
}

/**
 * The projects below the strip, as cards: the active ones, then the hidden and archived ones in a
 * group, closed until opened (and open while searching).
 */
export function ProjectCards({ projects, error, query, selected, actions }: { projects: Project[] | null; error: string; query: string; selected: string | null; actions: ProjectActions }) {
  const all = projects ?? [];
  const searching = query.trim() !== '';
  const shown = searching ? all.filter(project => projectMatches(project, query)) : all;
  const active = shown.filter(project => project.state === 'active');
  const aside = shown.filter(project => project.state !== 'active');
  const empty = projects === null ? '' : !all.length ? error || 'No projects yet.' : !shown.length ? 'No projects match.' : !active.length && !searching ? 'Every project is hidden or archived.' : '';
  return <ContextMenu aria-label="Project actions" density="compact" content={target => <ProjectMenu project={projectAt(all, target)} projects={all} actions={actions} />}>
    <div className="project-cards">
      {projects === null && <div className="project-list-state"><Spinner size="small" label="Loading projects" /></div>}
      {active.length > 0 && <div className="project-list" role="group" aria-label="Projects">
        {active.map(project => <ProjectCard key={project.folderId} project={project} selected={selected === project.folderId} actions={actions} />)}
      </div>}
      {empty && <Text variant="caption" tone="muted" className="project-list-state">{empty}</Text>}
      {aside.length > 0 && <details className="project-group" open={searching || undefined}>
        <summary>Hidden and archived <span className="muted">{aside.length}</span></summary>
        <div className="project-list" role="group" aria-label="Hidden and archived projects">
          {aside.map(project => <ProjectCard key={project.folderId} project={project} selected={selected === project.folderId} actions={actions} />)}
        </div>
      </details>}
    </div>
  </ContextMenu>;
}

/** Rename a project: the name in its planning.json, which agents see too. */
export function RenameProjectDialog({ project, onClose, onRename }: { project: Project; onClose(): void; onRename(name: string): Promise<void> }) {
  const [name, setName] = useState(project.name);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const rename = async () => {
    setBusy(true); setError('');
    try { await onRename(name.trim()); onClose(); }
    catch (failure) { setError((failure as Error).message); }
    finally { setBusy(false); }
  };
  return <Dialog open onOpenChange={open => { if (!open && !busy) onClose(); }} pending={busy} title="Rename project" closeLabel="Cancel"
    actions={<Button variant="primary" type="submit" form="rename-project" pending={busy} disabled={!name.trim() || name.trim() === project.name}>Rename</Button>}>
    <form id="rename-project" className="dialog-form" onSubmit={event => { event.preventDefault(); void rename(); }}>
      <Input label="Name" value={name} onChange={event => setName(event.target.value)} autoFocus maxLength={100} disabled={busy} hint="Kept in the project's planning.json, where agents read it too." />
      {error && <Notice tone="error" announce>{error}</Notice>}
    </form>
  </Dialog>;
}

interface RepositoryDraft { id: string; name: string; remote: string }
const blank = (): RepositoryDraft => ({ id: '', name: '', remote: '' });
/** A repository ID from a remote or a name: its last part, lowercase, with hyphens. */
const suggestedId = (draft: RepositoryDraft) => (draft.remote.replace(/\.git$/i, '').split(/[/:\\]/).filter(Boolean).at(-1) ?? draft.name).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');

/**
 * New Project: a name and the repositories it plans for (each with its Git remote, which is how
 * agents in a checkout find the project), made as a planning folder in the computer's Atlas home.
 */
export function NewProjectDialog({ computer, onClose, onCreated }: { computer: string; onClose(): void; onCreated(project: Project): void }) {
  const [name, setName] = useState('');
  const [repositories, setRepositories] = useState<RepositoryDraft[]>([blank()]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const change = (index: number, field: keyof RepositoryDraft, value: string) => setRepositories(current => current.map((item, at) => at === index ? { ...item, [field]: value } : item));
  const listed = repositories.filter(item => item.id.trim() || item.name.trim() || item.remote.trim());
  const create = async () => {
    setBusy(true); setError('');
    try {
      const chosen: ProjectRepository[] = listed.map(item => ({ id: item.id.trim() || suggestedId(item), name: item.name.trim() || item.id.trim() || suggestedId(item), remote: item.remote.trim() || null }));
      onCreated(await api.createProject(name.trim(), chosen));
      onClose();
    } catch (failure) { setError((failure as Error).message); }
    finally { setBusy(false); }
  };
  const field = (index: number, key: keyof RepositoryDraft, label: string, placeholder: string): ReactNode =>
    <Input label={label} value={repositories[index][key]} onChange={event => change(index, key, event.target.value)} placeholder={placeholder} spellCheck={false} autoComplete="off" disabled={busy} />;
  return <Dialog open onOpenChange={open => { if (!open && !busy) onClose(); }} pending={busy} size="wide" className="new-project-dialog" title="New project"
    description={<>A planning folder in the Atlas home on {computer}, with its own Git history. Agents working in a checkout of one of its repositories find it by the repository's Git remote.</>}
    closeLabel="Cancel" actions={<Button variant="primary" type="submit" form="new-project" pending={busy} disabled={!name.trim()}>Create</Button>}>
    <form id="new-project" className="dialog-form" onSubmit={event => { event.preventDefault(); void create(); }}>
      <Input label="Name" value={name} onChange={event => setName(event.target.value)} autoFocus maxLength={100} disabled={busy} placeholder="Coord" />
      <fieldset className="project-repositories">
        <legend>Repositories</legend>
        {repositories.map((_, index) => <div className="project-repository" key={index}>
          {field(index, 'remote', 'Git remote', 'git@github.com:example/coord.git')}
          {field(index, 'name', 'Name', 'Coord')}
          {field(index, 'id', 'ID', suggestedId(repositories[index]) || 'coord')}
          <Tooltip content="Remove this repository"><IconButton variant="text" icon={<CloseIcon />} aria-label={'Remove repository ' + (index + 1)} disabled={busy || repositories.length === 1} onClick={() => setRepositories(current => current.filter((__, at) => at !== index))} /></Tooltip>
        </div>)}
        <Button variant="text" startIcon={<AddIcon />} disabled={busy} onClick={() => setRepositories(current => [...current, blank()])}>Add repository</Button>
      </fieldset>
      {error && <Notice tone="error" announce>{error}</Notice>}
    </form>
  </Dialog>;
}
