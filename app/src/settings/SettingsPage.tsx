// Settings (File › Settings…), a page of the window with two sections, each a place of its own:
// Agents, the agents on this computer that Atlas connects (Claude Code and Codex), and Computers,
// pairing in both directions: the other computers this one connects to, and the devices that can
// reach the window's computer. In a window on another computer, Agents is still this computer's (it
// installs here), Devices that can reach follows the window's computer, and Other computers is this
// computer's.
import { useId, type ReactNode } from 'react';
import { NavigationItem, Notice, Text } from '@envsemble/envui';
import { Code } from '@envsemble/envui/content';
import type { ComputerRef, SettingsSection } from '../types';
import { AgentIcon, ComputerIcon } from '../ui/icons';
import { Page } from '../ui/Page';
import { AgentList, useAgents } from './AgentList';
import { OtherComputers } from '../computers/ComputerMenu';
import { RemoteAccess, remoteAccessTitle } from '../computers/RemoteAccess';

const sections: { id: SettingsSection; label: string; icon: ReactNode }[] = [
  { id: 'agents', label: 'Agents', icon: <AgentIcon /> },
  { id: 'computers', label: 'Computers', icon: <ComputerIcon /> },
];

export function SettingsPage({ section, computer, go }: { section: SettingsSection; computer: ComputerRef; go(section: SettingsSection): void }) {
  return <Page className="settings-page" title="Settings">
    <div className="settings-layout">
      <nav className="settings-nav" aria-label="Settings">
        {sections.map(item => <NavigationItem key={item.id} size="compact" className="settings-nav-item" data-section={item.id} icon={item.icon}
          selected={item.id === section} aria-current={item.id === section ? 'page' : undefined} onClick={() => go(item.id)}>{item.label}</NavigationItem>)}
      </nav>
      <div className="settings-content">
        {section === 'agents' ? <AgentsSection computer={computer} /> : <ComputersSection computer={computer} />}
      </div>
    </div>
  </Page>;
}

/** A part of a section: its heading, and what it holds. */
function SettingsGroup({ title, aside, children }: { title: string; aside?: ReactNode; children: ReactNode }) {
  const id = useId();
  return <section className="settings-group" aria-labelledby={id}>
    <div className="settings-group-heading"><Text as="h2" variant="section-heading" id={id}>{title}</Text>{aside}</div>
    {children}
  </section>;
}

/** The agents on this computer: each one's status and plugin version, connected or disconnected here. */
function AgentsSection({ computer }: { computer: ComputerRef }) {
  const agents = useAgents();
  const codex = agents.agents?.find(agent => agent.id === 'codex');
  return <SettingsGroup title="Agents" aside={<span className="settings-scope"><ComputerIcon /> This computer</span>}>
    <Text tone="muted" className="settings-description">Atlas connects Claude Code and Codex by installing its plugin into them: their sessions then plan with Atlas and report their work here. Updates of Atlas update the plugin in the connected agents.</Text>
    {computer.hostId !== null && <Notice tone="info">These are the agents on this computer, not on {computer.name}: connecting one installs Atlas’s plugin here. Agents on {computer.name} are connected in Atlas there.</Notice>}
    {agents.error && <Notice tone="warning" announce>{agents.error}</Notice>}
    <AgentList agents={agents} mode={{ kind: 'manage' }} label="Agents on this computer" />
    {codex?.connected && <p className="dialog-note">Codex asks once to trust Atlas’s hooks: in a new Codex session, type <Code>/hooks</Code> and trust them.</p>}
  </SettingsGroup>;
}

/** Pairing, both ways: the computers this one connects to, and the devices that can reach the window's computer. */
function ComputersSection({ computer }: { computer: ComputerRef }) {
  return <>
    <SettingsGroup title="Other computers"><OtherComputers current={computer} /></SettingsGroup>
    <SettingsGroup title={remoteAccessTitle(computer)}><RemoteAccess key={computer.hostId ?? 'local'} computer={computer} /></SettingsGroup>
  </>;
}
