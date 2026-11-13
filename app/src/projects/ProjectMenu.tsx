// The hub's project menu, where projects are chosen, made and managed: all projects or one (the
// hub shows its plans), and for the one chosen its folders, Show in Folder, Copy Path, Rename and
// Archive; the archived projects, each to restore; and New Project. Each project shows by its
// avatar, the initials of its name on a square in its own colour.
import { useState, type CSSProperties } from 'react';
import { Button, Menu } from '@envsemble/envui';
import { IconUnfoldMore } from '@envsemble/envui/icons/UnfoldMore';
import { NewProjectIcon } from '../ui/icons';
import type { Project, ProjectChangeRequest } from '../types';
import { api } from '../api';
import { hubPlace } from '../navigation/targets';
import { initials, projectFacts, projectHue } from './projectAvatar';
import { plural, relativeDate } from '../ui/format';
import { FoldersDialog, RenameProjectDialog, type ProjectActions } from './ProjectDialogs';

/** A project's avatar: its initials on a small square in its own hue. */
export function ProjectAvatar({ project }: { project: Project }) {
  return <span className="project-avatar" aria-hidden="true" style={{ '--project-hue': projectHue(project.id) } as CSSProperties}>{initials(project.name)}</span>;
}

/** What agents do on a project now, its open plans and when it changed, on one line. */
function facts(project: Project): string {
  const known = projectFacts(project);
  if (!known) return 'Its planning folder could not be read';
  return [known.waiting > 0 && known.waiting + (known.waiting === 1 ? ' needs' : ' need') + ' you', known.working > 0 && known.working + ' working', plural(known.open, 'open plan'), known.updated && 'changed ' + relativeDate(known.updated)].filter(Boolean).join(' · ');
}

export function ProjectMenu({ projects, chosen, computer, local, actions, newProject }: {
  projects: Project[]; chosen: Project | undefined; computer: string; local: boolean; actions: ProjectActions;
  /** Open Create project. */
  newProject(): void;
}) {
  const [renaming, setRenaming] = useState<Project | null>(null);
  const [detailed, setDetailed] = useState<string | null>(null);
  const active = projects.filter(project => project.state === 'active');
  const archived = projects.filter(project => project.state !== 'active');
  // The project whose folders show, as last listed: its folders may have changed meanwhile.
  const details = projects.find(project => project.id === detailed);
  const failed = (error: Error) => actions.notify(error.message);
  const change = (project: Project, request: ProjectChangeRequest) => { void actions.change(project, request); };
  return <>
    <Menu.Root aria-label="Project" align="end"
      trigger={<Button variant="secondary" className="hub-project" startIcon={chosen ? <ProjectAvatar project={chosen} /> : undefined} endIcon={<IconUnfoldMore />} aria-label={'Project: ' + (chosen?.name ?? 'All projects')}>
        <span className="hub-project-label">{chosen?.name ?? 'All projects'}</span>
      </Button>}>
      <Menu.RadioGroup value={chosen?.id ?? 'all'} onValueChange={value => actions.go(hubPlace(value === 'all' ? null : value))} label="Projects">
        <Menu.RadioItem value="all">All projects</Menu.RadioItem>
        {active.map(project => <Menu.RadioItem key={project.id} value={project.id} icon={<ProjectAvatar project={project} />} description={facts(project)}>{project.name}</Menu.RadioItem>)}
      </Menu.RadioGroup>
      {chosen && <>
        <Menu.Separator />
        <Menu.Group label={chosen.name}>
          <Menu.Item onClick={() => setDetailed(chosen.id)}>Folders…</Menu.Item>
          {local && <Menu.Item onClick={() => { api.reveal(chosen.id, 'planning.json').catch(failed); }}>Show in Folder</Menu.Item>}
          <Menu.Item onClick={() => { api.copy(chosen.path).catch(failed); }}>Copy Path</Menu.Item>
          <Menu.Item onClick={() => setRenaming(chosen)}>Rename…</Menu.Item>
          <Menu.Item onClick={() => { change(chosen, { state: 'archived' }); actions.go(hubPlace()); }}>Archive</Menu.Item>
        </Menu.Group>
      </>}
      {archived.length > 0 && <>
        <Menu.Separator />
        <Menu.Submenu label={'Archived projects (' + archived.length + ')'}>
          {archived.map(project => <Menu.Item key={project.id} icon={<ProjectAvatar project={project} />} onClick={() => change(project, { state: 'active' })}
            aria-label={'Restore ' + project.name} end={<span className="muted">Restore</span>}>{project.name}</Menu.Item>)}
        </Menu.Submenu>
      </>}
      <Menu.Separator />
      <Menu.Item icon={<NewProjectIcon />} onClick={newProject}>New Project…</Menu.Item>
    </Menu.Root>
    {renaming && <RenameProjectDialog project={renaming} onClose={() => setRenaming(null)} onRename={name => actions.update(renaming, { name })} />}
    {details && <FoldersDialog project={details} computer={computer} local={local} onClose={() => setDetailed(null)} onChange={folders => actions.update(details, { folders })} />}
  </>;
}
