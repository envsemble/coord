// The Projects page: every project of the window's computer, active, then archived more quietly, one compact row each: its name (leading to its plans), its planning folder and
// repositories in one muted line, the workspace folders it covers (an agent working in one of them,
// or inside one, belongs to the project), its statistics, and in its menu what can be done with it:
// add a workspace folder, rename, archive, restore, move into the Atlas home. A folder is
// removed from its row, quietly until the row is pointed at. Projects are made here too: a name and a
// folder. Workspace folders are paths on the project's own computer, so they are only chosen in Atlas
// there.
import { useEffect, useState } from 'react';
import { Badge, Button, Dialog, GroupedRows, IconButton, Input, Menu, MenuItem, MenuSeparator, Notice, Row, Spinner, Text, Tooltip } from '@envsemble/envui';
import { CloseIcon, FolderIcon, MoreIcon, NewProjectIcon, StatisticsIcon } from '../ui/icons';
import type { Project, ProjectChangeRequest, WorkspaceScan } from '../types';
import { fullPath } from '../../shared/contract';
import { api, AtlasError } from '../api';
import { hubPlace, statisticsPlace, type Place } from '../navigation/targets';
import { Page } from '../ui/Pages';

/** What the Projects page does with a project. */
export interface ProjectActions {
  /** Change a project; a failure rejects. */
  update(project: Project, change: ProjectChangeRequest): Promise<void>;
  /** Change a project; a failure is told in the window, and the promise settles either way. */
  change(project: Project, change: ProjectChangeRequest): Promise<void>;
  /** Move a project outside the Atlas home into it. */
  adopt(project: Project): void;
  created(project: Project): void;
  go(place: Place): void;
}

/** The last part of a folder's path, for a name. */
export const folderName = (folder: string) => folder.split(/[\\/]+/).filter(Boolean).at(-1) ?? '';
/** A folder given by its full path, as workspace folders are. */
const complete = (folder: string) => fullPath.test(folder.trim());

/** A folder of this computer, typed or chosen in the system's folder dialog. */
function FolderField({ value, onChange, disabled, autoFocus }: { value: string; onChange(folder: string, chosen: boolean): void; disabled: boolean; autoFocus?: boolean }) {
  const [error, setError] = useState('');
  const browse = () => {
    setError('');
    api.chooseFolder().then(folder => { if (folder) onChange(folder, true); }, failure => { if ((failure as AtlasError).code !== 'cancelled') setError((failure as Error).message); });
  };
  return <div className="folder-field">
    <Input label="Folder" value={value} onChange={event => onChange(event.target.value, false)} spellCheck={false} autoComplete="off"
      disabled={disabled} autoFocus={autoFocus} error={error || (value.trim() && !complete(value) ? 'Type the folder’s full path.' : undefined)} />
    <Button variant="secondary" disabled={disabled} onClick={browse}>Browse…</Button>
  </div>;
}

/** What a new project would register from its folder: the Git checkouts in it, looked into as the folder is chosen. */
function ScanPreview({ folder }: { folder: string }) {
  const [scan, setScan] = useState<{ folder: string; result: WorkspaceScan | null; unavailable: boolean; error: string } | null>(null);
  const path = folder.trim();
  useEffect(() => {
    if (!complete(path)) return;
    let current = true;
    const timer = window.setTimeout(() => {
      api.scanFolder(path).then(result => { if (current) setScan({ folder: path, result, unavailable: false, error: '' }); },
        failure => { if (current) setScan({ folder: path, result: null, unavailable: (failure as AtlasError).code === 'unavailable', error: (failure as Error).message }); });
    }, 300);
    return () => { current = false; window.clearTimeout(timer); };
  }, [path]);
  if (!complete(path)) return null;
  if (scan?.folder !== path) return <p className="dialog-note scan-state"><Spinner size="small" label="" />Looking for Git checkouts…</p>;
  if (scan.unavailable) return <p className="dialog-note scan-later">Atlas finds the Git checkouts in the folder, and in the folders directly inside it, when it creates the project, and registers their remotes as its repositories.</p>;
  if (!scan.result) return <p className="dialog-error">{scan.error}</p>;
  if (!scan.result.repositories.length) return <p className="dialog-note scan-none">No Git checkouts in this folder, or in the folders directly inside it.</p>;
  return <div className="scan-result">
    <Text as="h3" variant="caption" className="scan-heading">Repositories the project registers</Text>
    <ul className="scan-repositories">{scan.result.repositories.map(repository => <li key={repository.id}>
      <strong>{repository.name}</strong><span className="muted">{repository.remote ?? 'No remote'}</span>
    </li>)}</ul>
  </div>;
}

/**
 * New project: a name and a folder (its workspace), made as a planning folder in the computer's
 * Atlas home; the Git checkouts in the folder become its repositories. On another computer it gets a
 * name only: its folders are chosen in Atlas on that computer.
 */
export function NewProjectDialog({ computer, local, onClose, onCreated }: { computer: string; local: boolean; onClose(): void; onCreated(project: Project): void }) {
  const [name, setName] = useState('');
  // The folder names the project until the name is typed.
  const [named, setNamed] = useState(false);
  const [folder, setFolder] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const ready = Boolean(name.trim() && (complete(folder) || !local));
  const create = async () => {
    setBusy(true); setError('');
    try {
      onCreated(await api.createProject(name.trim(), local ? [folder.trim()] : []));
      onClose();
    } catch (failure) { setError((failure as Error).message); }
    finally { setBusy(false); }
  };
  const chooseFolder = (value: string) => { setFolder(value); if (!named) setName(folderName(value)); };
  return <Dialog open onOpenChange={open => { if (!open && !busy) onClose(); }} pending={busy} size="wide" className="new-project-dialog" title="New project"
    description={<>A planning folder in the Atlas home on {computer}, with its own Git history. Agents working in the project's folder, or in a folder inside it, find the project.</>}
    closeLabel="Cancel" actions={<Button variant="primary" type="submit" form="new-project" pending={busy} disabled={!ready}>Create</Button>}>
    <form id="new-project" className="dialog-form" onSubmit={event => { event.preventDefault(); if (ready) void create(); }}>
      <Input label="Name" value={name} onChange={event => { setName(event.target.value); setNamed(Boolean(event.target.value)); }} autoFocus maxLength={100} disabled={busy} placeholder="Coord" />
      {local ? <>
        <FolderField value={folder} onChange={chooseFolder} disabled={busy} />
        <ScanPreview folder={folder} />
      </> : <p className="dialog-note">Its workspace folders are on {computer}: choose them in Atlas there, on the Projects page.</p>}
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
function AddFolderDialog({ project, onClose, onAdd }: { project: Project; onClose(): void; onAdd(folder: string): Promise<void> }) {
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
    closeLabel="Cancel" actions={<Button variant="primary" type="submit" form="add-folder" pending={busy} disabled={!complete(folder)}>Add</Button>}>
    <form id="add-folder" className="dialog-form" onSubmit={event => { event.preventDefault(); if (complete(folder)) void add(); }}>
      <FolderField value={folder} onChange={setFolder} disabled={busy} autoFocus />
      {error && <Notice tone="error" announce>{error}</Notice>}
    </form>
  </Dialog>;
}

/** A project's actions: add a workspace folder, rename, archive or restore, and move it into the home. */
function ProjectMenu({ project, actions, rename, addFolder, busy, change }: { project: Project; actions: ProjectActions; rename(): void; addFolder: (() => void) | null; busy: boolean; change(change: ProjectChangeRequest): void }) {
  const state = (next: Project['state']) => change({ state: next });
  return <Menu aria-label={'Actions for ' + project.name} align="end" density="compact"
    trigger={<IconButton variant="text" icon={<MoreIcon />} aria-label={'Actions for ' + project.name} disabled={busy} />}>
    {addFolder && <><MenuItem onClick={addFolder}>Add Workspace Folder…</MenuItem><MenuSeparator /></>}
    <MenuItem onClick={rename}>Rename…</MenuItem>
    {project.outsideHome && <MenuItem onClick={() => actions.adopt(project)}>Move into the Atlas home</MenuItem>}
    <MenuSeparator />
    {project.state === 'active' ? <MenuItem onClick={() => state('archived')}>Archive</MenuItem> : <MenuItem onClick={() => state('active')}>Restore</MenuItem>}
  </Menu>;
}

/**
 * One project: its name (leading to its plans) and where it stands, its planning folder and
 * repositories in a muted line, its workspace folders, its statistics and its menu, which wait while
 * a change of it is on its way. On another computer its folders are shown, not changed.
 */
function ProjectRow({ project, computer, local, actions, rename, addFolder }: { project: Project; computer: string; local: boolean; actions: ProjectActions; rename(): void; addFolder(): void }) {
  const [busy, setBusy] = useState(false);
  const change = (request: ProjectChangeRequest) => { setBusy(true); void actions.change(project, request).finally(() => setBusy(false)); };
  const repositories = project.summary?.repositories ?? null;
  return <Row className="project-row" data-project={project.folderId} data-state={project.state} aria-busy={busy || undefined}
    title={<span className="row-title">
      <button type="button" className="row-link" title={'Plans of ' + project.name} onClick={() => actions.go(hubPlace(project.folderId))}><span className="row-link-title">{project.name}</span></button>
      {project.state !== 'active' && <Badge tone="warning">Archived</Badge>}
      {project.outsideHome && <Badge title="Agents do not find it until it is moved into the Atlas home">Outside the Atlas home</Badge>}
    </span>}
    detail={<span className="project-meta"><bdi className="project-path">{project.path}</bdi>
      <span className="project-repositories">{repositories === null ? 'Its planning folder could not be read' : repositories.length ? repositories.join(', ') : 'No repositories'}</span></span>}
    action={<span className="project-actions">
      <Button variant="text" startIcon={<StatisticsIcon />} onClick={() => actions.go(statisticsPlace(project.folderId))} aria-label={'Statistics of ' + project.name}>Statistics</Button>
      <ProjectMenu project={project} actions={actions} rename={rename} addFolder={local ? addFolder : null} busy={busy} change={change} />
    </span>}>
    {project.workspaces.length ? <ul className="project-folders" aria-label={'Workspace folders of ' + project.name}>{project.workspaces.map(folder => <li key={folder}>
      <FolderIcon /><bdi>{folder}</bdi>
      {local && <Tooltip content="Remove this folder"><IconButton variant="text" className="project-folder-remove" icon={<CloseIcon />} aria-label={'Remove ' + folder} disabled={busy}
        onClick={() => change({ workspaces: project.workspaces.filter(item => item !== folder) })} /></Tooltip>}
    </li>)}</ul> : local && <p className="project-folders-none muted">No workspace folders: agents find the project by its repositories’ remotes.</p>}
    {!local && <p className="project-folders-none muted">Folders are chosen in Atlas on {computer}.</p>}
  </Row>;
}

export function ProjectsPage({ projects, error, computer, local, actions }: { projects: Project[] | null; error: string; computer: string; local: boolean; actions: ProjectActions }) {
  const [creating, setCreating] = useState(false);
  const [renaming, setRenaming] = useState<Project | null>(null);
  const [adding, setAdding] = useState<string | null>(null);
  const active = (projects ?? []).filter(project => project.state === 'active');
  const aside = (projects ?? []).filter(project => project.state !== 'active');
  // The project a folder is added to, as last listed: its folders may have changed meanwhile.
  const target = projects?.find(project => project.folderId === adding);
  const list = (items: Project[], label: string) => <GroupedRows className="project-list" aria-label={label}>
    {items.map(project => <ProjectRow key={project.folderId} project={project} computer={computer} local={local} actions={actions} rename={() => setRenaming(project)} addFolder={() => setAdding(project.folderId)} />)}
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
        {aside.length > 0 && <section className="projects-aside" aria-label="Archived projects">
          <Text as="h2" variant="section-heading">Archived</Text>
          {list(aside, 'Archived projects')}
        </section>}
      </>}
    {creating && <NewProjectDialog computer={computer} local={local} onClose={() => setCreating(false)} onCreated={actions.created} />}
    {renaming && <RenameProjectDialog project={renaming} onClose={() => setRenaming(null)} onRename={name => actions.update(renaming, { name })} />}
    {target && <AddFolderDialog project={target} onClose={() => setAdding(null)} onAdd={folder => actions.update(target, { workspaces: [...target.workspaces.filter(item => item !== folder), folder] })} />}
  </Page>;
}
