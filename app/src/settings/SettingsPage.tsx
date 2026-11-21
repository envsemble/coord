// Settings (the title bar's Settings), a page of the window with four sections, each a place of its
// own: General, the app's appearance; Agents, the agents on this computer that Coord connects (Claude
// Code and Codex); Computers, pairing in both directions: the other computers this one connects to,
// and the devices that can reach the window's computer; and Updates, this app's version, release
// channel and update. The sections are a side list beside the section shown, or a segmented control
// above it where the page is narrow. In a window on another computer, Agents is still this computer's
// (it installs here), Devices that can reach follows the window's computer, and Other computers is
// this computer's.
import { useId, useRef, type ReactNode } from 'react';
import { Alert, NavigationDrawer, SegmentedControl, Text, useContainerSize, windowClassOf } from '@envsemble/envui';
import type { ComputerRef, SettingsSection } from '../types';
import { AgentIcon, ComputerIcon, SettingsIcon, UpdateIcon } from '../ui/icons';
import { Page } from '../ui/Page';
import { AgentList, useAgents } from './AgentList';
import { OtherComputers } from '../computers/ComputerMenu';
import { RemoteAccess, remoteAccessTitle } from '../computers/RemoteAccess';
import { UpdatesSection } from './Updates';
import { ThemeChoice } from './Appearance';

export function SettingsPage({ section, computer, go }: { section: SettingsSection; computer: ComputerRef; go(section: SettingsSection): void }) {
  const frame = useRef<HTMLDivElement>(null);
  const size = useContainerSize(frame);
  // The sections keep a column of their own once the page has room beside the section.
  const beside = size !== undefined && !['compact', 'medium'].includes(windowClassOf(size.inlineSize));
  const sections: { id: SettingsSection; label: string; icon: ReactNode; content: ReactNode }[] = [
    { id: 'general', label: 'General', icon: <SettingsIcon />, content: <SettingsGroup title="Appearance"><ThemeChoice /></SettingsGroup> },
    { id: 'agents', label: 'Agents', icon: <AgentIcon />, content: <AgentsSection computer={computer} /> },
    { id: 'computers', label: 'Computers', icon: <ComputerIcon />, content: <ComputersSection computer={computer} /> },
    { id: 'updates', label: 'Updates', icon: <UpdateIcon />, content: <SettingsGroup title="Updates" aside={thisComputer}><UpdatesSection /></SettingsGroup> },
  ];
  const shown = sections.find(item => item.id === section) ?? sections[0]!;
  return <Page className="settings-page" title="Settings" width="lg">
    <div ref={frame} className="settings-frame" data-beside={beside || undefined}>
      {beside
        ? <NavigationDrawer aria-label="Settings" className="settings-sections" background="page"
          destinations={sections.map(item => ({ id: item.id, label: item.label, icon: item.icon, current: item.id === shown.id, onClick: () => go(item.id) }))} />
        : <SegmentedControl aria-label="Settings" className="settings-sections" value={shown.id} onValueChange={value => go(value as SettingsSection)}
          items={sections.map(item => ({ value: item.id, label: item.label, start: item.icon }))} />}
      <div className="settings-content">{shown.content}</div>
    </div>
  </Page>;
}

const thisComputer = <span className="settings-scope"><ComputerIcon /> This computer</span>;

/** A part of a section: its heading, and what it holds. */
function SettingsGroup({ title, aside, children }: { title: string; aside?: ReactNode; children: ReactNode }) {
  const id = useId();
  return <section className="settings-group" aria-labelledby={id}>
    <div className="settings-group-heading"><Text render={<h2 />} variant="title" id={id}>{title}</Text>{aside}</div>
    {children}
  </section>;
}

/** The agents on this computer: each one's status and plugin version, whether it runs Coord, connected or disconnected here. */
function AgentsSection({ computer }: { computer: ComputerRef }) {
  const agents = useAgents();
  return <SettingsGroup title="Agents" aside={thisComputer}>
    <Text variant="body-sm" emphasis="muted" className="settings-description">Connecting an agent installs Coord’s plugin in it, so its sessions plan with Coord and report their work here.</Text>
    {computer.hostId !== null && <Alert tone="info">These are the agents on this computer, not on {computer.name}: connecting one installs Coord’s plugin here. Agents on {computer.name} are connected in Coord there.</Alert>}
    {agents.error && <Alert tone="warning" announce>{agents.error}</Alert>}
    <AgentList agents={agents} mode={{ kind: 'manage' }} label="Agents on this computer" />
  </SettingsGroup>;
}

/** Pairing, both ways: the computers this one connects to, and the devices that can reach the window's computer. */
function ComputersSection({ computer }: { computer: ComputerRef }) {
  return <>
    <SettingsGroup title="Other computers"><OtherComputers current={computer} /></SettingsGroup>
    <SettingsGroup title={remoteAccessTitle(computer)}><RemoteAccess key={computer.hostId ?? 'local'} computer={computer} /></SettingsGroup>
  </>;
}
