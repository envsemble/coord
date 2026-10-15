// The sidebar's projects: those of the computer the window shows, in their order, each opening its
// project page; hidden and archived projects wait in a group at the bottom, closed until opened. A
// project's context menu renames it, moves it, and hides, archives or shows it again; projects are
// never deleted here. New Project… makes one from the bundled templates.
import { useState, type ReactNode } from 'react';
import { Button, ContextMenu, Dialog, IconButton, Input, MenuItem, MenuSeparator, NavigationItem, Notice, Spinner, Text, Tooltip } from '@envsemble/envui';
import { AddIcon, ArchiveIcon, CloseIcon, FolderIcon } from './icons';
import type { Project, ProjectRepository, ProjectState } from './types';
import { api } from './api';

export interface ProjectActions {
  /** Show a project's page. */
  open(project: Project): void;
  update(project: Project, change: { name?: string; state?: ProjectState; position?: number }): void;
  rename(project: Project): void;
  create(): void;
}

const stateLabels: Record<ProjectState, string> = { active: 'Active', hidden: 'Hidden', archived: 'Archived' };

/** One project in the sidebar: it opens its page; its context menu is the list's. */
function ProjectItem({ project, selected, actions }: { project: Project; selected: boolean; actions: ProjectActions }) {
  return <NavigationItem icon={project.state === 'archived' ? <ArchiveIcon /> : <FolderIcon />} selected={selected} data-project={project.folderId}
    title={project.path} onClick={() => actions.open(project)}
    trailing={project.state === 'active' ? undefined : <span className="project-state">{stateLabels[project.state]}</span>}>{project.name}</NavigationItem>;
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
    <MenuSeparator />
    <MenuItem disabled={index <= 0} onClick={() => move(-1)}>Move Up</MenuItem>
    <MenuItem disabled={index < 0 || index >= peers.length - 1} onClick={() => move(1)}>Move Down</MenuItem>
    <MenuSeparator />
    {project.state !== 'active' && <MenuItem onClick={() => actions.update(project, { state: 'active' })}>{project.state === 'archived' ? 'Restore' : 'Show'}</MenuItem>}
    {project.state !== 'hidden' && <MenuItem onClick={() => actions.update(project, { state: 'hidden' })}>Hide</MenuItem>}
    {project.state !== 'archived' && <MenuItem onClick={() => actions.update(project, { state: 'archived' })}>Archive</MenuItem>}
  </>;
}

/** The projects as the sidebar's navigation: the active ones, then New Project. */
export function ProjectsNavigation({ projects, error, selected, actions }: { projects: Project[] | null; error: string; selected: string | null; actions: ProjectActions }) {
  const active = (projects ?? []).filter(project => project.state === 'active');
  return <ContextMenu aria-label="Project actions" density="compact" content={target => <ProjectMenu project={projectAt(projects ?? [], target)} projects={projects ?? []} actions={actions} />}>
    <div className="project-list" role="group" aria-label="Projects">
      {projects === null ? <div className="project-list-state"><Spinner size="small" label="Loading projects" /></div>
        : active.map(project => <ProjectItem key={project.folderId} project={project} selected={selected === project.folderId} actions={actions} />)}
      {projects !== null && !active.length && <Text variant="caption" tone="muted" className="project-list-state">{error || 'No projects yet.'}</Text>}
      <NavigationItem icon={<AddIcon />} onClick={actions.create}>New Project…</NavigationItem>
    </div>
  </ContextMenu>;
}

/** Hidden and archived projects, in a group at the bottom of the sidebar, closed until opened. */
export function SetAsideProjects({ projects, selected, actions }: { projects: Project[] | null; selected: string | null; actions: ProjectActions }) {
  const aside = (projects ?? []).filter(project => project.state !== 'active');
  if (!aside.length) return null;
  return <details className="project-group">
    <summary>Hidden and archived <span className="muted">{aside.length}</span></summary>
    <ContextMenu aria-label="Project actions" density="compact" content={target => <ProjectMenu project={projectAt(aside, target)} projects={projects ?? []} actions={actions} />}>
      <div className="project-list" role="group" aria-label="Hidden and archived projects">
        {aside.map(project => <ProjectItem key={project.folderId} project={project} selected={selected === project.folderId} actions={actions} />)}
      </div>
    </ContextMenu>
  </details>;
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
