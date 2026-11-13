// Settings (File › Settings…), a page of the window with two sections, each a place of its own:
// Agents, the agents on this computer that Atlas connects (Claude Code and Codex), and Computers,
// pairing in both directions: the other computers this one connects to, and the devices that can
// reach the window's computer. In a window on another computer, Agents is still this computer's (it
// installs here), Devices that can reach follows the window's computer, and Other computers is this
// computer's.
import { useId, type ReactNode } from 'react';
import { Alert, NavigationDrawer, Text } from '@envsemble/envui';
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
      <NavigationDrawer className="settings-nav" aria-label="Settings" background="page"
        destinations={sections.map(item => ({ label: item.label, icon: item.icon, current: item.id === section, onClick: () => go(item.id) }))} />
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
    <div className="settings-group-heading"><Text render={<h2 />} variant="title" id={id}>{title}</Text>{aside}</div>
    {children}
  </section>;
}

/** The agents on this computer: each one's status and plugin version, whether it runs Atlas, connected or disconnected here. */
function AgentsSection({ computer }: { computer: ComputerRef }) {
  const agents = useAgents();
  return <SettingsGroup title="Agents" aside={<span className="settings-scope"><ComputerIcon /> This computer</span>}>
    <Text emphasis="muted" className="settings-description">Atlas connects Claude Code and Codex by installing its plugin into them: their sessions then plan with Atlas and report their work here. Updates of Atlas update the plugin in the connected agents.</Text>
    {computer.hostId !== null && <Alert tone="info">These are the agents on this computer, not on {computer.name}: connecting one installs Atlas’s plugin here. Agents on {computer.name} are connected in Atlas there.</Alert>}
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
