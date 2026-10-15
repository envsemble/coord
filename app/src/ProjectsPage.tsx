// The Projects page, from the menu: every project of the window's computer, active, hidden and
// archived, with its planning folder, the workspace folders it covers (an agent working in one of
// them, or inside one, belongs to the project) and its repositories, and what can be done with it:
// rename, hide, show, archive, restore, move into the Atlas home, and add or remove workspace
// folders. Projects are made here too: a name and a folder. Projects are for agents; the hub is where
// their plans are read.
import { useEffect, useState } from 'react';
import { Badge, Button, Dialog, GroupedRows, IconButton, Input, Menu, MenuItem, MenuSeparator, Notice, Row, Spinner, Text, Tooltip } from '@envsemble/envui';
import { AddIcon, CloseIcon, FolderIcon, MoreIcon, NewProjectIcon } from './icons';
import type { Project, ProjectChangeRequest, WorkspaceScan } from './types';
import { api, AtlasError } from './api';
import { hubPlace, type Place } from './targets';
import { Page } from './Pages';

/** What the Projects page does with a project. */
export interface ProjectActions {
  /** Change a project; a failure rejects. */
  update(project: Project, change: ProjectChangeRequest): Promise<void>;
  /** Change a project; a failure is told in the window. */
  change(project: Project, change: ProjectChangeRequest): void;
  /** Move a project outside the Atlas home into it. */
  adopt(project: Project): void;
  created(project: Project): void;
  go(place: Place): void;
}

const stateLabels = { hidden: 'Hidden', archived: 'Archived' } as const;
/** The last part of a folder's path, for a name. */
const folderName = (folder: string) => folder.split(/[\\/]+/).filter(Boolean).at(-1) ?? '';

/** A folder's path, typed or chosen in the system's folder dialog (on this computer only). */
function FolderField({ value, onChange, local, disabled, autoFocus }: { value: string; onChange(folder: string): void; local: boolean; disabled: boolean; autoFocus?: boolean }) {
  const [error, setError] = useState('');
  const browse = () => {
    setError('');
    api.chooseFolder().then(folder => { if (folder) onChange(folder); }, failure => { if ((failure as AtlasError).code !== 'cancelled') setError((failure as Error).message); });
  };
  return <div className="folder-field">
    <Input label="Folder" value={value} onChange={event => onChange(event.target.value)} placeholder={local ? undefined : 'A folder on that computer'} spellCheck={false} autoComplete="off"
      disabled={disabled} autoFocus={autoFocus} error={error || undefined} />
    {local && <Button variant="secondary" disabled={disabled} onClick={browse}>Browse…</Button>}
  </div>;
}

/** What a new project would register from its folder: the Git checkouts in it, looked into as the folder is chosen. */
function ScanPreview({ folder, local }: { folder: string; local: boolean }) {
  const [scan, setScan] = useState<{ folder: string; result: WorkspaceScan | null; unavailable: boolean; error: string } | null>(null);
  const path = folder.trim();
  useEffect(() => {
    if (!local || !path) return;
    let current = true;
    const timer = window.setTimeout(() => {
      api.scanFolder(path).then(result => { if (current) setScan({ folder: path, result, unavailable: false, error: '' }); },
        failure => { if (current) setScan({ folder: path, result: null, unavailable: (failure as AtlasError).code === 'unavailable', error: (failure as Error).message }); });
    }, 300);
    return () => { current = false; window.clearTimeout(timer); };
  }, [path, local]);
  const later = <p className="dialog-note">Atlas finds the Git checkouts in the folder, and in the folders directly inside it, when it creates the project, and registers their remotes as its repositories.</p>;
  if (!path) return null;
  if (!local) return later;
  if (scan?.folder !== path) return <p className="dialog-note scan-state"><Spinner size="small" label="" />Looking for Git checkouts…</p>;
  if (scan.unavailable) return later;
  if (!scan.result) return <p className="dialog-error">{scan.error}</p>;
  if (!scan.result.repositories.length) return <p className="dialog-note">No Git checkouts in this folder, or in the folders directly inside it.</p>;
  return <div className="scan-result">
    <Text as="h3" variant="caption" className="scan-heading">Repositories the project registers</Text>
    <ul className="scan-repositories">{scan.result.repositories.map(repository => <li key={repository.id}>
      <strong>{repository.name}</strong><span className="muted">{repository.remote ?? 'No remote'}</span>
    </li>)}</ul>
  </div>;
}

/**
 * New project: a name and a folder (its workspace), made as a planning folder in the computer's
 * Atlas home. The Git checkouts in the folder become its repositories.
 */
export function NewProjectDialog({ computer, local, onClose, onCreated }: { computer: string; local: boolean; onClose(): void; onCreated(project: Project): void }) {
  const [name, setName] = useState('');
  const [folder, setFolder] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const ready = Boolean(name.trim() && folder.trim());
  const create = async () => {
    setBusy(true); setError('');
    try {
      onCreated(await api.createProject(name.trim(), [folder.trim()]));
      onClose();
    } catch (failure) { setError((failure as Error).message); }
    finally { setBusy(false); }
  };
  // A folder chosen first names the project.
  const chooseFolder = (value: string) => { setFolder(value); if (!name.trim() && value !== folder.trim()) setName(folderName(value)); };
  return <Dialog open onOpenChange={open => { if (!open && !busy) onClose(); }} pending={busy} size="wide" className="new-project-dialog" title="New project"
    description={<>A planning folder in the Atlas home on {computer}, with its own Git history. Agents working in the project's folder, or in a folder inside it, find the project.</>}
    closeLabel="Cancel" actions={<Button variant="primary" type="submit" form="new-project" pending={busy} disabled={!ready}>Create</Button>}>
    <form id="new-project" className="dialog-form" onSubmit={event => { event.preventDefault(); if (ready) void create(); }}>
      <Input label="Name" value={name} onChange={event => setName(event.target.value)} autoFocus maxLength={100} disabled={busy} placeholder="Coord" />
      <FolderField value={folder} onChange={chooseFolder} local={local} disabled={busy} />
      <ScanPreview folder={folder} local={local} />
      {error && <Notice tone="error" announce>{error}</Notice>}
    </form>
  </Dialog>;
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

/** Add a workspace folder to a project: agents working in it, or inside it, belong to the project. */
function AddFolderDialog({ project, local, onClose, onAdd }: { project: Project; local: boolean; onClose(): void; onAdd(folder: string): Promise<void> }) {
  const [folder, setFolder] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const add = async () => {
    setBusy(true); setError('');
    try { await onAdd(folder.trim()); onClose(); }
    catch (failure) { setError((failure as Error).message); }
    finally { setBusy(false); }
  };
  return <Dialog open onOpenChange={open => { if (!open && !busy) onClose(); }} pending={busy} size="wide" title={'Add a folder to ' + project.name}
    description="Agents working in the folder, or in a folder inside it, belong to this project. The Git checkouts in it become its repositories."
    closeLabel="Cancel" actions={<Button variant="primary" type="submit" form="add-folder" pending={busy} disabled={!folder.trim()}>Add</Button>}>
    <form id="add-folder" className="dialog-form" onSubmit={event => { event.preventDefault(); if (folder.trim()) void add(); }}>
      <FolderField value={folder} onChange={setFolder} local={local} disabled={busy} autoFocus />
      {error && <Notice tone="error" announce>{error}</Notice>}
    </form>
  </Dialog>;
}

/** A project's actions: rename, hide or show, archive or restore, and move it into the home. */
function ProjectMenu({ project, actions, rename }: { project: Project; actions: ProjectActions; rename(): void }) {
  const change = (state: Project['state']) => actions.change(project, { state });
  return <Menu aria-label={'Actions for ' + project.name} align="end" density="compact"
    trigger={<IconButton variant="text" icon={<MoreIcon />} aria-label={'Actions for ' + project.name} />}>
    <MenuItem onClick={rename}>Rename…</MenuItem>
    {project.outsideHome && <MenuItem onClick={() => actions.adopt(project)}>Move into the Atlas home</MenuItem>}
    <MenuSeparator />
    {project.state === 'hidden' && <MenuItem onClick={() => change('active')}>Show</MenuItem>}
    {project.state === 'archived' && <MenuItem onClick={() => change('active')}>Restore</MenuItem>}
    {project.state !== 'hidden' && <MenuItem onClick={() => change('hidden')}>Hide</MenuItem>}
    {project.state !== 'archived' && <MenuItem onClick={() => change('archived')}>Archive</MenuItem>}
  </Menu>;
}

/** One project: its name (leading to its plans), where it stands, its folders and repositories, and its actions. */
function ProjectRow({ project, actions, rename, addFolder }: { project: Project; actions: ProjectActions; rename(): void; addFolder(): void }) {
  const repositories = project.summary?.repositories ?? null;
  const remove = (folder: string) => actions.change(project, { workspaces: project.workspaces.filter(item => item !== folder) });
  return <Row className="project-row" data-project={project.folderId} data-state={project.state}
    title={<span className="row-title">
      <button type="button" className="row-link" title={'Plans of ' + project.name} onClick={() => actions.go(hubPlace(project.folderId))}><span className="row-link-title">{project.name}</span></button>
      {project.state !== 'active' && <Badge tone="warning">{stateLabels[project.state]}</Badge>}
      {project.outsideHome && <Badge title="Agents do not find it until it is moved into the Atlas home">Outside the Atlas home</Badge>}
    </span>}
    detail={<bdi className="project-path">{project.path}</bdi>}
    action={<ProjectMenu project={project} actions={actions} rename={rename} />}>
    <dl className="project-facts">
      <div>
        <dt>Workspace folders</dt>
        <dd>
          {project.workspaces.length ? <ul className="project-folders">{project.workspaces.map(folder => <li key={folder}>
            <FolderIcon /><bdi>{folder}</bdi>
            <Tooltip content="Remove this folder"><IconButton variant="text" icon={<CloseIcon />} aria-label={'Remove ' + folder} onClick={() => remove(folder)} /></Tooltip>
          </li>)}</ul> : <span className="muted">None: agents find the project by its repositories' remotes.</span>}
          <Button variant="text" startIcon={<AddIcon />} className="project-add-folder" onClick={addFolder}>Add folder…</Button>
        </dd>
      </div>
      <div>
        <dt>Repositories</dt>
        <dd>{repositories === null ? <span className="muted">Its planning folder could not be read.</span> : repositories.length ? repositories.join(' · ') : <span className="muted">None</span>}</dd>
      </div>
    </dl>
  </Row>;
}

export function ProjectsPage({ projects, error, computer, local, actions }: { projects: Project[] | null; error: string; computer: string; local: boolean; actions: ProjectActions }) {
  const [creating, setCreating] = useState(false);
  const [renaming, setRenaming] = useState<Project | null>(null);
  const [adding, setAdding] = useState<Project | null>(null);
  const active = (projects ?? []).filter(project => project.state === 'active');
  const aside = (projects ?? []).filter(project => project.state !== 'active');
  const list = (items: Project[], label: string) => <GroupedRows className="project-list" aria-label={label}>
    {items.map(project => <ProjectRow key={project.folderId} project={project} actions={actions} rename={() => setRenaming(project)} addFolder={() => setAdding(project)} />)}
  </GroupedRows>;
  return <Page className="projects-page" heading={<div className="page-heading-row">
    <Text as="h1" variant="page-heading">Projects</Text>
    <span className="spacer" />
    <Button variant="secondary" startIcon={<NewProjectIcon />} onClick={() => setCreating(true)}>New project</Button>
  </div>}>
    <Text variant="body" tone="muted" className="projects-intro">The planning folders in the Atlas home on {computer}. Each covers workspace folders: agents working in one of them, or in a folder inside it, plan in that project.</Text>
    {error && <Notice tone="warning">{error}</Notice>}
    {projects === null ? <Spinner label="Loading projects" />
      : !projects.length ? <Text variant="body" tone="muted">No projects yet.</Text>
      : <>
        {active.length > 0 && list(active, 'Projects')}
        {aside.length > 0 && <section className="projects-aside" aria-label="Hidden and archived projects">
          <Text as="h2" variant="section-heading">Hidden and archived</Text>
          {list(aside, 'Hidden and archived projects')}
        </section>}
      </>}
    {creating && <NewProjectDialog computer={computer} local={local} onClose={() => setCreating(false)} onCreated={actions.created} />}
    {renaming && <RenameProjectDialog project={renaming} onClose={() => setRenaming(null)} onRename={name => actions.update(renaming, { name })} />}
    {adding && <AddFolderDialog project={adding} local={local} onClose={() => setAdding(null)} onAdd={folder => actions.update(adding, { workspaces: [...adding.workspaces.filter(item => item !== folder), folder] })} />}
  </Page>;
}
