// Making and changing projects, from the hub's project menu: Create project (a name and the folders
// it covers: an agent working in one of them, or inside one, belongs to the project), Rename, and a
// project's folders. Folders are paths on the project's own computer, so they are only chosen in
// Coord there.
import { useState } from 'react';
import { Alert, Button, Dialog, IconButton, List, Text, TextField, Tooltip } from '@envsemble/envui';
import { AddFolderIcon, AddIcon, CloseIcon, ComputerIcon, FolderIcon } from '../ui/icons';
import type { Project, ProjectChangeRequest } from '../types';
import { api, CoordError } from '../api';
import type { Place } from '../navigation/targets';

/** What the hub's project menu does with a project. */
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
/** Whether this computer's folders are told apart without case, as on Windows and macOS (folders are chosen on this computer only). */
const caseInsensitive = /^(?:win|mac)/i.test(navigator.platform);
/**
 * A folder's path as compared with another, without trailing separators: a Windows path (a drive's,
 * or a share's, also written `//server/share`) with either separator, and without case where this
 * computer ignores it.
 */
const folderKey = (folder: string) => {
  let key = folder.trim();
  const windows = /^(?:[a-z]:|[\\/]{2}[^\\/])/i.test(key);
  if (windows) key = key.replace(/\//g, '\\');
  key = key.replace(/(?<=.)[\\/]+$/, '');
  return windows || caseInsensitive ? key.toLowerCase() : key;
};

/** A folder chosen in the system's folder dialog (Explorer, Finder): its path, or null when the person cancelled. */
async function pickFolder(): Promise<string | null> {
  try { return await api.chooseFolder(); }
  catch (failure) { if ((failure as CoordError).code === 'cancelled') return null; throw failure; }
}

/**
 * The folders of this computer a new project covers, chosen in the system's folder dialog, never
 * typed: their rows, each by its name over its path, with a way to remove it, then a button to
 * add one.
 */
function FolderList({ value, onChange, disabled, computer }: { value: string[]; onChange(folders: string[]): void; disabled: boolean; computer: string }) {
  const [error, setError] = useState('');
  const add = () => {
    setError('');
    pickFolder().then(folder => { if (folder && !value.some(item => folderKey(item) === folderKey(folder))) onChange([...value, folder]); }, failure => setError((failure as Error).message));
  };
  return <section className="folder-list-section" aria-label="Folders">
    <div className="folder-list-heading">
      <Text render={<h3 />} variant="body" className="folder-list-title">Folders</Text>
      <span className="folder-list-computer"><ComputerIcon /> {computer}</span>
    </div>
    {value.length > 0 && <List.Root className="folder-list" aria-label="Folders">{value.map(folder => <List.Item key={folder}
      start={<FolderIcon className="folder-list-icon" />}
      label={<bdi>{folderName(folder) || folder}</bdi>}
      description={<bdi className="folder-list-path" title={folder}>{folder}</bdi>}
      end={<Tooltip content="Remove"><IconButton variant="ghost" size="sm" icon={<CloseIcon />} aria-label={'Remove ' + (folderName(folder) || folder)} disabled={disabled} onClick={() => onChange(value.filter(item => item !== folder))} /></Tooltip>} />)}
    </List.Root>}
    <Button variant="outline" className="folder-list-add" fullWidth startIcon={<AddFolderIcon />} disabled={disabled} onClick={add}>Add folder</Button>
    {error && <Alert tone="danger" announce>{error}</Alert>}
  </section>;
}

/**
 * Create project: a name and the folders it covers, made as a planning folder in the computer's Coord
 * home. On another computer it gets a name only: its folders are chosen in Coord on that computer.
 */
export function NewProjectDialog({ computer, local, onClose, onCreated }: { computer: string; local: boolean; onClose(): void; onCreated(project: Project): void }) {
  const [name, setName] = useState('');
  // The first folder names the project until the name is typed.
  const [named, setNamed] = useState(false);
  const [folders, setFolders] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  // A project may cover no folders yet: agents then find it in its planning folder only.
  const ready = Boolean(name.trim());
  const create = async () => {
    setBusy(true); setError('');
    try {
      onCreated(await api.createProject(name.trim(), local ? folders : []));
      onClose();
    } catch (failure) { setError((failure as Error).message); }
    finally { setBusy(false); }
  };
  const chooseFolders = (next: string[]) => { setFolders(next); if (!named) setName(next.length ? folderName(next[0]) : ''); };
  return <Dialog open onOpenChange={open => { if (!open && !busy) onClose(); }} pending={busy} className="new-project-dialog" title="Create project"
    description={local ? 'Add the folders where you work on it, such as its repositories. An agent working in one of them keeps its plans in this project.' : <>Its folders are chosen in Coord on {computer}, from the project menu of its plans.</>}
    closeLabel="Cancel" actions={<Button variant="primary" type="submit" form="new-project" pending={busy} disabled={!ready}>Create project</Button>}>
    <form id="new-project" className="dialog-form" onSubmit={event => { event.preventDefault(); if (ready) void create(); }}>
      <TextField label="Project name" placeholder="Project name" startIcon={<FolderIcon />} value={name} onValueChange={value => { setName(value); setNamed(Boolean(value)); }} autoFocus maxLength={100} disabled={busy} />
      {local && <FolderList value={folders} onChange={chooseFolders} disabled={busy} computer={computer} />}
      {error && <Alert tone="danger" announce>{error}</Alert>}
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
      <TextField label="Name" value={name} onValueChange={setName} autoFocus maxLength={100} disabled={busy} description="Kept in the project's planning.json, where agents read it too." />
      {error && <Alert tone="danger" announce>{error}</Alert>}
    </form>
  </Dialog>;
}

/**
 * A project's folders: its planning folder and the folders it covers (an agent working in one of
 * them, or inside one, belongs to the project), added (chosen in the system's folder dialog) and
 * removed here on its own computer.
 */
export function FoldersDialog({ project, computer, local, onClose, onChange }: { project: Project; computer: string; local: boolean; onClose(): void; onChange(folders: string[]): Promise<void> }) {
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
  return <Dialog open onOpenChange={open => { if (!open && !busy) onClose(); }} width="lg" title={project.name + ': folders'} closeLabel="Close"
    actions={local ? <Button variant="secondary" startIcon={<AddIcon />} disabled={busy} onClick={() => void add()}>Add folder…</Button> : undefined}>
    <div className="dialog-form project-details">
      <section><Text render={<h3 />} variant="caption" className="project-details-heading">Planning folder</Text><bdi className="project-details-path">{project.path}</bdi></section>
      <section>
        <Text render={<h3 />} variant="caption" className="project-details-heading">Folders</Text>
        {project.folders.length ? <List.Root className="project-folders" density="sm" aria-label="Folders">{project.folders.map(folder => <List.Item key={folder}
          start={<FolderIcon className="folder-list-icon" />} label={<bdi className="project-details-path">{folder}</bdi>}
          end={local ? <IconButton variant="ghost" size="sm" icon={<CloseIcon />} aria-label={'Remove ' + folder} disabled={busy} onClick={() => void remove(folder)} /> : undefined} />)}
        </List.Root> : <Text render={<p />} emphasis="muted">None: agents find the project only in its planning folder.</Text>}
        {!local && <Text render={<p />} emphasis="muted">Folders are chosen in Coord on {computer}.</Text>}
      </section>
      {error && <Alert tone="danger" announce>{error}</Alert>}
    </div>
  </Dialog>;
}
