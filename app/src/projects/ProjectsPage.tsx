// The Projects page: every project of the window's computer in one table, active, then archived more
// quietly under a fold, one row each: its avatar (its initials), its name (leading to its plans) over
// one muted line with what agents do on it, its open plans and when it changed; the folders it covers
// (an agent working in one of them, or inside one, belongs to the project), its statistics, and in its
// menu what can be done with it: its folders, rename, archive, restore. Projects are made here too: a
// name and a folder. Folders are paths on the project's own computer, so they are only chosen in
// Atlas there.
import { useId, useState } from 'react';
import { Button, Dialog, EmptyState, IconButton, Input, Menu, MenuItem, MenuSeparator, Notice, Spinner, Table, TableBody, TableCell, TableHead, TableHeaderCell, TableRow, Text, Tooltip } from '@envsemble/envui';
import { AddIcon, ChevronRightIcon, CloseIcon, FolderIcon, FolderOpenIcon, MoreIcon, NewProjectIcon, StatisticsIcon } from '../ui/icons';
import { StatusIcon } from '../ui/ui';
import { statuses } from '../ui/status';
import { absoluteDate, plural, relativeDate } from '../ui/format';
import { initials, projectFacts } from './projectLook';
import type { Project, ProjectChangeRequest } from '../types';
import { api, AtlasError } from '../api';
import { hubPlace, statisticsPlace, type Place } from '../navigation/targets';
import { Page } from '../ui/Pages';

/** What the Projects page does with a project. */
export interface ProjectActions {
  /** Change a project; a failure rejects. */
  update(project: Project, change: ProjectChangeRequest): Promise<void>;
  /** Change a project; a failure is told in the window, and the promise settles either way. */
  change(project: Project, change: ProjectChangeRequest): Promise<void>;
  created(project: Project): void;
  go(place: Place): void;
  /** Tell a failure in the window. */
  notify(message: string): void;
}

/** The last part of a folder's path, for a name. */
export const folderName = (folder: string) => folder.split(/[\\/]+/).filter(Boolean).at(-1) ?? '';
/** A folder's path as compared with another: on Windows without case, and either separator; without trailing separators. */
const folderKey = (folder: string) => {
  const trimmed = folder.trim().replace(/(?<=.)[\\/]+$/, '');
  return /^(?:[a-z]:|\\\\)/i.test(trimmed) ? trimmed.replace(/\//g, '\\').toLowerCase() : trimmed;
};

/** A folder chosen in the system's folder dialog (Explorer, Finder): its path, or null when the person cancelled. */
async function pickFolder(): Promise<string | null> {
  try { return await api.chooseFolder(); }
  catch (failure) { if ((failure as AtlasError).code === 'cancelled') return null; throw failure; }
}

/**
 * The folders of this computer a new project covers, chosen in the system's folder dialog, never
 * typed: each by its name (its full path on hover) with a way to remove it, then a button to add
 * one. Under them, what the folders are for.
 */
function FolderChoice({ value, onChange, disabled, hint }: { value: string[]; onChange(folders: string[]): void; disabled: boolean; hint: string }) {
  const [error, setError] = useState('');
  const id = useId();
  const add = () => {
    setError('');
    pickFolder().then(folder => { if (folder && !value.some(item => folderKey(item) === folderKey(folder))) onChange([...value, folder]); }, failure => setError((failure as Error).message));
  };
  return <div className="folder-choice" role="group" aria-labelledby={id + '-label'} aria-describedby={error ? undefined : id + '-hint'}>
    <Text as="span" variant="caption" id={id + '-label'} className="folder-choice-label">Folders</Text>
    {value.map(folder => <div key={folder} className="folder-choice-chosen">
      <FolderIcon className="folder-choice-icon" />
      <bdi className="folder-choice-name" title={folder}>{folderName(folder) || folder}</bdi>
      <Tooltip content="Remove the folder"><IconButton variant="quiet" icon={<CloseIcon />} aria-label={'Remove ' + (folderName(folder) || folder)} disabled={disabled} onClick={() => onChange(value.filter(item => item !== folder))} /></Tooltip>
    </div>)}
    <Button variant="secondary" className="folder-choice-button" startIcon={<FolderOpenIcon />} disabled={disabled} onClick={add}>{value.length ? 'Add folder…' : 'Choose folder…'}</Button>
    {error ? <Notice tone="error" announce>{error}</Notice> : <Text as="small" variant="caption" tone="muted" id={id + '-hint'}>{hint}</Text>}
  </div>;
}

/**
 * New project: a name and the folders it covers, made as a planning folder in the computer's Atlas home.
 * On another computer it gets a name only: its folders are chosen in Atlas on that computer.
 */
export function NewProjectDialog({ computer, local, onClose, onCreated }: { computer: string; local: boolean; onClose(): void; onCreated(project: Project): void }) {
  const [name, setName] = useState('');
  // The first folder names the project until the name is typed.
  const [named, setNamed] = useState(false);
  const [folders, setFolders] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const ready = Boolean(name.trim() && (folders.length || !local));
  const create = async () => {
    setBusy(true); setError('');
    try {
      onCreated(await api.createProject(name.trim(), local ? folders : []));
      onClose();
    } catch (failure) { setError((failure as Error).message); }
    finally { setBusy(false); }
  };
  const chooseFolders = (next: string[]) => { setFolders(next); if (!named) setName(next.length ? folderName(next[0]) : ''); };
  return <Dialog open onOpenChange={open => { if (!open && !busy) onClose(); }} pending={busy} size={local ? 'wide' : 'standard'} className="new-project-dialog" title="New project"
    description={<>A planning folder for its plans, with its own Git history, in the Atlas home on {computer}.</>}
    closeLabel="Cancel" actions={<Button variant="primary" type="submit" form="new-project" pending={busy} disabled={!ready}>Create</Button>}>
    <form id="new-project" className="dialog-form" onSubmit={event => { event.preventDefault(); if (ready) void create(); }}>
      <Input label="Name" value={name} onChange={event => { setName(event.target.value); setNamed(Boolean(event.target.value)); }} autoFocus maxLength={100} disabled={busy} />
      {local ? <FolderChoice value={folders} onChange={chooseFolders} disabled={busy} hint="Agents working in one of these folders, or in a folder inside one, find the project." />
        : <Notice tone="info">Its folders are on {computer}: choose them in Atlas there, on the Projects page.</Notice>}
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

/** A project's actions: its folders, its planning folder, rename, and archive or restore. */
function ProjectMenu({ project, actions, local, rename, details, busy, change }: { project: Project; actions: ProjectActions; local: boolean; rename(): void; details(): void; busy: boolean; change(change: ProjectChangeRequest): void }) {
  const state = (next: Project['state']) => change({ state: next });
  const failed = (error: Error) => actions.notify(error.message);
  return <Menu aria-label={'Actions for ' + project.name} align="end" density="compact"
    trigger={<IconButton variant="quiet" icon={<MoreIcon />} aria-label={'Actions for ' + project.name} disabled={busy} />}>
    <MenuItem onClick={details}>Folders…</MenuItem>
    {local && <MenuItem onClick={() => { api.reveal(project.folderId, 'planning.json').catch(failed); }}>Show in Folder</MenuItem>}
    <MenuItem onClick={() => { api.copy(project.path).catch(failed); }}>Copy Path</MenuItem>
    <MenuSeparator />
    <MenuItem onClick={rename}>Rename…</MenuItem>
    <MenuSeparator />
    {project.state === 'active' ? <MenuItem onClick={() => state('archived')}>Archive</MenuItem> : <MenuItem onClick={() => state('active')}>Restore</MenuItem>}
  </Menu>;
}

/**
 * A project's folders: its planning folder and the folders it covers (an agent working in one of
 * them, or inside one, belongs to the project), added (chosen in the system's folder dialog) and
 * removed here on its own computer.
 */
function FoldersDialog({ project, computer, local, onClose, onChange }: { project: Project; computer: string; local: boolean; onClose(): void; onChange(folders: string[]): Promise<void> }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const run = async (next: () => Promise<string[] | null>) => {
    setBusy(true); setError('');
    try { const folders = await next(); if (folders) await onChange(folders); }
    catch (failure) { setError((failure as Error).message); }
    finally { setBusy(false); }
  };
  const add = () => run(async () => {
    const folder = await pickFolder();
    return folder ? [...project.folders.filter(item => folderKey(item) !== folderKey(folder)), folder] : null;
  });
  const remove = (folder: string) => run(async () => project.folders.filter(item => item !== folder));
  return <Dialog open onOpenChange={open => { if (!open && !busy) onClose(); }} size="wide" title={project.name + ': folders'} closeLabel="Close"
    actions={local ? <Button variant="secondary" startIcon={<AddIcon />} disabled={busy} onClick={() => void add()}>Add folder…</Button> : undefined}>
    <div className="dialog-form project-details">
      <section><Text as="h3" variant="caption" className="project-details-heading">Planning folder</Text><bdi className="project-details-path">{project.path}</bdi></section>
      <section>
        <Text as="h3" variant="caption" className="project-details-heading">Folders</Text>
        {project.folders.length ? <ul className="project-folders">{project.folders.map(folder => <li key={folder} className="project-folder">
          <FolderIcon /><bdi>{folder}</bdi>
          {local && <IconButton variant="quiet" icon={<CloseIcon />} aria-label={'Remove ' + folder} disabled={busy} onClick={() => void remove(folder)} />}
        </li>)}</ul> : <p className="muted">None: agents find the project only in its planning folder.</p>}
        {!local && <p className="muted">Folders are chosen in Atlas on {computer}.</p>}
      </section>
      {error && <Notice tone="error" announce>{error}</Notice>}
    </div>
  </Dialog>;
}

/** A folder's own name, for a column too narrow for its path. */
const shortFolder = (folder: string) => folderName(folder) || folder;

/**
 * One project, a row of the table: its avatar and name (leading to its plans) over what agents do on
 * it now, its open plans and when it changed; its folder by its name (the full paths on hover); and
 * its statistics and menu, which wait while a change of it is on its way.
 */
function ProjectRow({ project, local, actions, rename, details }: { project: Project; local: boolean; actions: ProjectActions; rename(): void; details(): void }) {
  const [busy, setBusy] = useState(false);
  const change = (request: ProjectChangeRequest) => { setBusy(true); void actions.change(project, request).finally(() => setBusy(false)); };
  const facts = projectFacts(project);
  const live = project.state === 'active' ? facts : null;
  const [first, ...more] = project.folders;
  return <TableRow className="project-row" data-project={project.folderId} data-state={project.state} data-group={project.state === 'active' ? 'active' : 'archived'} aria-busy={busy || undefined}>
    <TableCell>
      <span className="project-cell">
        <span className="project-avatar" aria-hidden="true">{initials(project.name)}</span>
        <span className="project-name">
          {/* An archived project's plans are seen nowhere, so its name leads nowhere. */}
          {project.state === 'active' ? <button type="button" className="row-link" title={'Plans of ' + project.name} onClick={() => actions.go(hubPlace(project.folderId))}><span className="row-link-title">{project.name}</span></button>
            : <span className="row-link-title project-name-plain">{project.name}</span>}
          <small className="cell-note project-meta">
            {live && live.waiting > 0 && <span className="project-fact" data-live="waiting"><StatusIcon status={statuses.waiting} decorative />{live.waiting} {live.waiting === 1 ? 'needs' : 'need'} you</span>}
            {live && live.working > 0 && <span className="project-fact"><StatusIcon status={statuses.working} decorative />{live.working} working</span>}
            {facts ? <span className="project-fact" title={facts.updated ? 'Changed ' + absoluteDate(facts.updated) : undefined}>{[plural(facts.open, 'open plan'), facts.updated && 'changed ' + relativeDate(facts.updated)].filter(Boolean).join(' · ')}</span>
              : <span className="project-fact">Its planning folder could not be read</span>}
          </small>
        </span>
      </span>
    </TableCell>
    <TableCell>{first ? <span className="project-folder-summary" title={project.folders.join('\n')}><FolderIcon /><bdi>{shortFolder(first)}</bdi>{more.length > 0 && <span className="project-folder-more">+{more.length}</span>}</span> : <span className="muted">—</span>}</TableCell>
    <TableCell align="end" nowrap>
      <span className="project-actions">
        <Tooltip content="Statistics"><IconButton variant="quiet" icon={<StatisticsIcon />} aria-label={'Statistics of ' + project.name} onClick={() => actions.go(statisticsPlace(project.folderId))} /></Tooltip>
        <ProjectMenu project={project} actions={actions} local={local} rename={rename} details={details} busy={busy} change={change} />
      </span>
    </TableCell>
  </TableRow>;
}

/** Project, folder, actions. */
const columnWidths = [62, 26, 12];

export function ProjectsPage({ projects, error, computer, local, actions }: { projects: Project[] | null; error: string; computer: string; local: boolean; actions: ProjectActions }) {
  const [creating, setCreating] = useState(false);
  const [renaming, setRenaming] = useState<Project | null>(null);
  const [detailed, setDetailed] = useState<string | null>(null);
  const [archivedShown, setArchivedShown] = useState(false);
  const active = (projects ?? []).filter(project => project.state === 'active');
  const aside = (projects ?? []).filter(project => project.state !== 'active');
  // The project whose folders show, as last listed: its folders may have changed meanwhile.
  const details = projects?.find(project => project.folderId === detailed);
  const row = (project: Project) => <ProjectRow key={project.folderId} project={project} local={local} actions={actions} rename={() => setRenaming(project)} details={() => setDetailed(project.folderId)} />;
  return <Page className="projects-page" heading={<div className="page-heading-row">
    <Text as="h1" variant="page-heading">Projects</Text>
    <span className="spacer" />
    <Button variant="secondary" startIcon={<NewProjectIcon />} onClick={() => setCreating(true)}>New project</Button>
  </div>}>
    {error && <Notice tone="warning">{error}</Notice>}
    {/* One table under one header: the active projects, then the archived under a fold of their own. */}
    {projects === null ? <Spinner label="Loading projects" />
      : !projects.length ? <EmptyState className="page-empty" align="center" icon={<NewProjectIcon />} title="No projects yet" description="Plans live in projects. Make one here, or ask an agent to." />
      : <Table className="project-list" aria-label="Projects" columnWidths={columnWidths}>
        <TableHead><TableRow><TableHeaderCell>Project</TableHeaderCell><TableHeaderCell>Folder</TableHeaderCell><TableHeaderCell align="end" aria-label="Actions" /></TableRow></TableHead>
        {active.length > 0 && <TableBody>{active.map(row)}</TableBody>}
        {aside.length > 0 && <TableBody className="projects-aside">
          <TableRow className="projects-aside-row">
            <TableCell colSpan={3}>
              <button type="button" className="projects-aside-toggle" aria-expanded={archivedShown} onClick={() => setArchivedShown(!archivedShown)}>
                <ChevronRightIcon className="projects-aside-icon" />Archived <span className="projects-aside-count">{aside.length}</span>
              </button>
            </TableCell>
          </TableRow>
          {archivedShown && aside.map(row)}
        </TableBody>}
      </Table>}
    {creating && <NewProjectDialog computer={computer} local={local} onClose={() => setCreating(false)} onCreated={actions.created} />}
    {renaming && <RenameProjectDialog project={renaming} onClose={() => setRenaming(null)} onRename={name => actions.update(renaming, { name })} />}
    {details && <FoldersDialog project={details} computer={computer} local={local} onClose={() => setDetailed(null)} onChange={folders => actions.update(details, { folders })} />}
  </Page>;
}
