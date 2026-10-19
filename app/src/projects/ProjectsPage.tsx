// The Projects page: every project of the window's computer, active, then archived more quietly,
// one row each: its avatar (its initials), its name (leading to its plans),
// its open plans with what agents do on them and when it changed, its repositories and the workspace
// folders it covers as chips (an agent working in one of them, or inside one, belongs to the
// project), its planning folder quietly, its statistics, and in its menu what can be done with it:
// add a workspace folder, rename, archive, restore, move into the Atlas home. A folder is removed
// from its row, quietly until the row is pointed at. Projects are made here too: a name and a
// folder. Workspace folders are paths on the project's own computer, so they are only chosen in Atlas
// there.
import { useEffect, useState } from 'react';
import { Badge, Button, Dialog, IconButton, Input, Menu, MenuItem, MenuSeparator, Notice, Spinner, Table, TableBody, TableCell, TableHead, TableHeaderCell, TableRow, Text, Tooltip } from '@envsemble/envui';
import { AddIcon, ChevronRightIcon, CloseIcon, FolderIcon, MoreIcon, NewProjectIcon, RepositoryIcon, StatisticsIcon } from '../ui/icons';
import { StatusIcon } from '../ui/ui';
import { statuses } from '../ui/status';
import { plural, relativeDate } from '../ui/format';
import { initials, projectFacts } from './projectLook';
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
  /** Tell a failure in the window. */
  notify(message: string): void;
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

/** A project's actions: its folders and repositories, its planning folder, rename, archive or restore, and move it into the home. */
function ProjectMenu({ project, actions, local, rename, details, busy, change }: { project: Project; actions: ProjectActions; local: boolean; rename(): void; details(): void; busy: boolean; change(change: ProjectChangeRequest): void }) {
  const state = (next: Project['state']) => change({ state: next });
  const failed = (error: Error) => actions.notify(error.message);
  return <Menu aria-label={'Actions for ' + project.name} align="end" density="compact"
    trigger={<IconButton variant="text" icon={<MoreIcon />} aria-label={'Actions for ' + project.name} disabled={busy} />}>
    <MenuItem onClick={details}>Folders and Repositories…</MenuItem>
    {local && <MenuItem onClick={() => { api.reveal(project.folderId, 'planning.json').catch(failed); }}>Show in Folder</MenuItem>}
    <MenuItem onClick={() => { api.copy(project.path).catch(failed); }}>Copy Path</MenuItem>
    <MenuSeparator />
    <MenuItem onClick={rename}>Rename…</MenuItem>
    {project.outsideHome && <MenuItem onClick={() => actions.adopt(project)}>Move into the Atlas home</MenuItem>}
    <MenuSeparator />
    {project.state === 'active' ? <MenuItem onClick={() => state('archived')}>Archive</MenuItem> : <MenuItem onClick={() => state('active')}>Restore</MenuItem>}
  </Menu>;
}

/**
 * A project's folders and repositories: its planning folder, the workspace folders it covers (an
 * agent working in one of them, or inside one, belongs to the project), added and removed here on its
 * own computer, and the repositories it plans for.
 */
function FoldersDialog({ project, computer, local, onClose, onAdd, onChange }: { project: Project; computer: string; local: boolean; onClose(): void; onAdd(): void; onChange(workspaces: string[]): Promise<void> }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const remove = async (folder: string) => {
    setBusy(true); setError('');
    try { await onChange(project.workspaces.filter(item => item !== folder)); }
    catch (failure) { setError((failure as Error).message); }
    finally { setBusy(false); }
  };
  const repositories = project.summary?.repositories ?? null;
  return <Dialog open onOpenChange={open => { if (!open && !busy) onClose(); }} size="wide" title={project.name + ': folders and repositories'} closeLabel="Close"
    actions={local ? <Button variant="secondary" startIcon={<AddIcon />} disabled={busy} onClick={onAdd}>Add folder…</Button> : undefined}>
    <div className="dialog-form project-details">
      <section><Text as="h3" variant="caption" className="project-details-heading">Planning folder</Text><bdi className="project-details-path">{project.path}</bdi></section>
      <section>
        <Text as="h3" variant="caption" className="project-details-heading">Workspace folders</Text>
        {project.workspaces.length ? <ul className="project-folders project-workspaces">{project.workspaces.map(folder => <li key={folder} className="project-folder">
          <FolderIcon /><bdi>{folder}</bdi>
          {local && <IconButton variant="text" icon={<CloseIcon />} aria-label={'Remove ' + folder} disabled={busy} onClick={() => void remove(folder)} />}
        </li>)}</ul> : <p className="muted">None: agents find the project by its repositories’ remotes.</p>}
        {!local && <p className="muted">Folders are chosen in Atlas on {computer}.</p>}
      </section>
      <section>
        <Text as="h3" variant="caption" className="project-details-heading">Repositories</Text>
        {repositories === null ? <p className="muted">Its planning folder could not be read.</p> : repositories.length ? <ul className="project-folders">{repositories.map(repository => <li key={repository} className="project-folder"><RepositoryIcon /><span>{repository}</span></li>)}</ul> : <p className="muted">None</p>}
      </section>
      {error && <Notice tone="error" announce>{error}</Notice>}
    </div>
  </Dialog>;
}

/** A folder's own name, for a column too narrow for its path. */
const shortFolder = (folder: string) => folderName(folder) || folder;

/**
 * One project, a row of the table: its avatar and name (leading to its plans) with its open plans and
 * when it changed, what agents do on it now, its workspace folder, and its statistics and menu, which
 * wait while a change of it is on its way.
 */
function ProjectRow({ project, local, actions, rename, details }: { project: Project; local: boolean; actions: ProjectActions; rename(): void; details(): void }) {
  const [busy, setBusy] = useState(false);
  const change = (request: ProjectChangeRequest) => { setBusy(true); void actions.change(project, request).finally(() => setBusy(false)); };
  const facts = projectFacts(project);
  const [first, ...more] = project.workspaces;
  return <TableRow className="project-row" data-project={project.folderId} data-state={project.state} aria-busy={busy || undefined}>
    <TableCell>
      <span className="project-cell">
        <span className="project-avatar" aria-hidden="true">{initials(project.name)}</span>
        <span className="project-name">
          <span className="row-title">
            <button type="button" className="row-link" title={'Plans of ' + project.name} onClick={() => actions.go(hubPlace(project.folderId))}><span className="row-link-title">{project.name}</span></button>
            {project.outsideHome && <Badge title="Agents do not find it until it is moved into the Atlas home">Outside the Atlas home</Badge>}
          </span>
          <small className="cell-note">{facts ? [plural(facts.open, 'open plan'), facts.updated && 'changed ' + relativeDate(facts.updated)].filter(Boolean).join(' · ') : 'Its planning folder could not be read'}</small>
        </span>
      </span>
    </TableCell>
    <TableCell>{facts && project.state === 'active' && (facts.waiting > 0 || facts.working > 0) ? <span className="project-status">
      {facts.waiting > 0 && <span className="project-fact"><StatusIcon status={statuses.waiting} decorative />{facts.waiting} {facts.waiting === 1 ? 'needs' : 'need'} you</span>}
      {facts.working > 0 && <span className="project-fact"><StatusIcon status={statuses.working} decorative />{facts.working} working</span>}
    </span> : null}</TableCell>
    <TableCell>{first ? <span className="project-workspace" title={project.workspaces.join('\n')}><FolderIcon /><bdi>{shortFolder(first)}</bdi>{more.length > 0 && <span className="muted">+{more.length}</span>}</span> : <span className="muted">—</span>}</TableCell>
    <TableCell numeric nowrap>
      <span className="project-actions">
        <Tooltip content="Statistics"><IconButton variant="text" icon={<StatisticsIcon />} aria-label={'Statistics of ' + project.name} onClick={() => actions.go(statisticsPlace(project.folderId))} /></Tooltip>
        <ProjectMenu project={project} actions={actions} local={local} rename={rename} details={details} busy={busy} change={change} />
      </span>
    </TableCell>
  </TableRow>;
}

/** Project, status, workspace folder, actions: the same widths in both tables, so the columns line up. */
const columnWidths = [46, 22, 22, 10];

export function ProjectsPage({ projects, error, computer, local, actions }: { projects: Project[] | null; error: string; computer: string; local: boolean; actions: ProjectActions }) {
  const [creating, setCreating] = useState(false);
  const [renaming, setRenaming] = useState<Project | null>(null);
  const [adding, setAdding] = useState<string | null>(null);
  const [detailed, setDetailed] = useState<string | null>(null);
  const [archivedShown, setArchivedShown] = useState(false);
  const active = (projects ?? []).filter(project => project.state === 'active');
  const aside = (projects ?? []).filter(project => project.state !== 'active');
  // The project a folder is added to, or whose folders show, as last listed: its folders may have changed meanwhile.
  const target = projects?.find(project => project.folderId === adding);
  const details = projects?.find(project => project.folderId === detailed);
  const list = (items: Project[], label: string) => <Table className="project-list" aria-label={label} columnWidths={columnWidths}>
    <TableHead><TableRow><TableHeaderCell>Project</TableHeaderCell><TableHeaderCell>Agents</TableHeaderCell><TableHeaderCell>Workspace folder</TableHeaderCell><TableHeaderCell numeric aria-label="Actions" /></TableRow></TableHead>
    <TableBody>{items.map(project => <ProjectRow key={project.folderId} project={project} local={local} actions={actions} rename={() => setRenaming(project)} details={() => setDetailed(project.folderId)} />)}</TableBody>
  </Table>;
  return <Page className="projects-page" heading={<div className="page-heading-row">
    <Text as="h1" variant="page-heading">Projects</Text>
    <span className="spacer" />
    <Button variant="secondary" startIcon={<NewProjectIcon />} onClick={() => setCreating(true)}>New project</Button>
  </div>}>
    <Text variant="caption" tone="muted" className="projects-intro">The planning folders in the Atlas home on {computer}.</Text>
    {error && <Notice tone="warning">{error}</Notice>}
    {projects === null ? <Spinner label="Loading projects" />
      : !projects.length ? <Text variant="body" tone="muted">No projects yet.</Text>
      : <>
        {active.length > 0 && list(active, 'Projects')}
        {aside.length > 0 && <section className="projects-aside">
          <button type="button" className="projects-aside-toggle" aria-expanded={archivedShown} onClick={() => setArchivedShown(!archivedShown)}>
            <ChevronRightIcon className="projects-aside-icon" /><Text as="span" variant="section-heading">Archived</Text> <span className="muted">{aside.length}</span>
          </button>
          {archivedShown && list(aside, 'Archived projects')}
        </section>}
      </>}
    {creating && <NewProjectDialog computer={computer} local={local} onClose={() => setCreating(false)} onCreated={actions.created} />}
    {renaming && <RenameProjectDialog project={renaming} onClose={() => setRenaming(null)} onRename={name => actions.update(renaming, { name })} />}
    {details && !target && <FoldersDialog project={details} computer={computer} local={local} onClose={() => setDetailed(null)} onAdd={() => setAdding(details.folderId)} onChange={workspaces => actions.update(details, { workspaces })} />}
    {target && <AddFolderDialog project={target} onClose={() => setAdding(null)} onAdd={folder => actions.update(target, { workspaces: [...target.workspaces.filter(item => item !== folder), folder] })} />}
  </Page>;
}
