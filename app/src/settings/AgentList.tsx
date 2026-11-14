// The agents on this computer, one row each: its mark and name over its status, and at the end what
// can be done with it. Settings' Agents section connects and disconnects them; the onboarding uses
// the same rows to choose the agents to connect, then to connect them. Connecting or disconnecting
// one can take a while: its row shows it, and the others stay usable. An agent not found on this
// computer is greyed, with a link to install it and Choose program… for one the PATH does not have;
// the list checks again whenever it shows and as the window comes forward, so one installed (or
// trusted) meanwhile shows as it is. A connected agent's row says whether it runs Coord, and in
// Settings each row can show the commands that connect it by hand.
import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { Alert, Button, Checkbox, Disclosure, List, Spinner } from '@envsemble/envui';
import { Code } from '@envsemble/envui/code';
import { agentIds, agentNames } from '../../shared/contract';
import type { AgentFolder, AgentId, AgentState } from '../types';
import { api, CoordError } from '../api';
import { AgentLogo } from './AgentLogo';
import { agentCheckLine, agentInstallPages, agentStatus, agentWarnings, byHandCommands, finished, idle, started, withAgent, type AgentActivity } from './agents';
import { CheckIcon } from '../ui/icons';
import { CopyButton } from '../ui/CopyButton';
import { absoluteDate, relativeDate } from '../ui/format';

/** The agents on this computer and what is happening to each, with ways to check them again and to connect or disconnect one. */
export function useAgents() {
  const [agents, setAgents] = useState<AgentState[] | null>(null);
  const [error, setError] = useState('');
  const [activity, setActivity] = useState<Partial<Record<AgentId, AgentActivity>>>({});
  // Why the program last chosen for an agent cannot be it.
  const [refused, setRefused] = useState<Partial<Record<AgentId, string>>>({});
  // While an agent connects or disconnects, a check would show it halfway; its result says how it is after.
  const running = useRef(0);
  const mounted = useRef(true);
  const check = useCallback(() => {
    if (running.current) return;
    api.agents().then(next => { if (mounted.current && !running.current) { setAgents(next); setError(''); } },
      failure => { if (mounted.current) { setAgents(current => current ?? []); setError((failure as Error).message); } });
  }, []);
  useEffect(() => {
    mounted.current = true;
    check();
    window.addEventListener('focus', check);
    return () => { mounted.current = false; window.removeEventListener('focus', check); };
  }, [check]);
  const run = useCallback(async (id: AgentId, action: 'connect' | 'disconnect') => {
    running.current++;
    setActivity(current => ({ ...current, [id]: started(action) }));
    try {
      const change = await (action === 'connect' ? api.connectAgent(id) : api.disconnectAgent(id));
      if (!mounted.current) return;
      setAgents(current => withAgent(current, change.agent));
      setActivity(current => ({ ...current, [id]: finished(action, { change }) }));
    } catch (failure) {
      if (!mounted.current) return;
      const cancelled = (failure as CoordError).code === 'cancelled';
      setActivity(current => ({ ...current, [id]: finished(action, { error: cancelled ? null : (failure as Error).message }) }));
    } finally { running.current--; }
  }, []);
  const program = useCallback(async (id: AgentId, choose: boolean) => {
    try {
      const change = choose ? await api.chooseAgentProgram(id) : { agent: await api.clearAgentProgram(id), error: null };
      if (!mounted.current || !change) return;
      setAgents(current => withAgent(current, change.agent));
      setRefused(current => ({ ...current, [id]: change.error ?? undefined }));
    } catch (failure) { if (mounted.current) setRefused(current => ({ ...current, [id]: (failure as Error).message })); }
  }, []);
  return {
    agents, error, check,
    activity: (id: AgentId) => activity[id] ?? idle,
    refused: (id: AgentId) => refused[id] ?? null,
    /** Whether any agent is connecting or disconnecting now. */
    busy: Object.values(activity).some(item => item?.running),
    connect: (id: AgentId) => void run(id, 'connect'),
    disconnect: (id: AgentId) => void run(id, 'disconnect'),
    /** Choose the agent's program in main's file dialog; or forget the one chosen. */
    chooseProgram: (id: AgentId) => void program(id, true),
    clearProgram: (id: AgentId) => void program(id, false),
  };
}
export type Agents = ReturnType<typeof useAgents>;

/**
 * The agents as last checked, with whether each connected one runs Coord, read again as the window
 * comes forward: cheap (no agent's command runs), for the hub's notice.
 */
export function useAgentChecks() {
  const [agents, setAgents] = useState<AgentState[] | null>(null);
  useEffect(() => {
    let live = true;
    const read = () => { api.agentChecks().then(next => { if (live) setAgents(next); }, () => undefined); };
    read();
    window.addEventListener('focus', read);
    return () => { live = false; window.removeEventListener('focus', read); };
  }, []);
  return agents;
}

/** `/hooks` in a line, as code. */
const withCode = (text: string) => text.split('/hooks').flatMap((part, index) => index ? [<Code key={index}>/hooks</Code>, part] : [part]);

/**
 * A notice for each connected agent of this computer whose check warns, saying it is this
 * computer's (a window may show another), with `action` (the hub's link to Settings) after it.
 */
export function AgentWarnings({ agents, action }: { agents: readonly AgentState[] | null; action?: ReactNode }) {
  return <>{agentWarnings(agents).map(agent => <Alert key={agent.id} tone="warning" className="agent-warning" data-agent={agent.id} actions={action}>
    {agent.check?.status === 'untrusted' ? <>Codex on this computer doesn’t trust Coord’s hooks yet: type <Code>/hooks</Code> in Codex and trust them.</>
      : agent.id === 'codex' ? <>Codex on this computer isn’t running Coord’s hooks: type <Code>/hooks</Code> in Codex and trust them.</>
      : <>{agentNames[agent.id]} on this computer isn’t running Coord’s hooks.</>}
  </Alert>)}</>;
}

/** Open an agent's install page in the browser. */
function InstallLink({ agent }: { agent: AgentState }) {
  return <Button variant="text" underline className="agent-install" onClick={() => { api.openExternal(agentInstallPages[agent.id]).catch(() => undefined); }}>Install {agentNames[agent.id]}</Button>;
}

/**
 * How the rows act: `manage` connects and disconnects (Settings), `choose` ticks the ones to connect
 * (the onboarding's Agents step), `connect` shows each chosen agent's connection as it is made (its Connect step).
 */
export type AgentListMode = { kind: 'manage' } | { kind: 'choose'; chosen: AgentId[]; choose(id: AgentId, chosen: boolean): void } | { kind: 'connect'; only: AgentId[] };

export function AgentList({ agents: state, mode, label = 'Agents' }: { agents: Agents; mode: AgentListMode; label?: string }) {
  const { agents, activity } = state;
  // The folder and marketplace the commands for connecting by hand name (Settings only).
  const [folder, setFolder] = useState<AgentFolder | null>(null);
  useEffect(() => { if (mode.kind === 'manage') api.agentFolder().then(setFolder, () => undefined); }, [mode.kind]);
  if (agents === null) return <Spinner label="Checking the agents on this computer" />;
  const shown = agents.filter(agent => mode.kind !== 'connect' || mode.only.includes(agent.id))
    .sort((a, b) => agentIds.indexOf(a.id) - agentIds.indexOf(b.id));
  return <List.Root className="agent-list" aria-label={label}>{shown.map(agent => {
    const now = activity(agent.id);
    return <List.Item key={agent.id} className="agent-row" data-agent={agent.id} data-found={agent.found} aria-busy={now.running ? true : undefined}
      label={<span className="agent-name"><AgentLogo agent={agent.id} /><span className="row-link-title">{agentNames[agent.id]}</span></span>}
      description={<AgentDetail agent={agent} activity={now} state={state} mode={mode} folder={folder} />}
      end={<span className="row-actions agent-actions">{action(agent, now, mode, state)}</span>} />;
  })}</List.Root>;
}

/** An agent's status (with, connected, whether it runs Coord), what is happening to it, or why the last change failed. */
function AgentDetail({ agent, activity, state, mode, folder }: { agent: AgentState; activity: AgentActivity; state: Agents; mode: AgentListMode; folder: AgentFolder | null }) {
  let line: ReactNode = agentStatus(agent);
  if (activity.running) line = <span className="agent-progress"><Spinner size="sm" label="" />{activity.running === 'connect' ? 'Connecting… this can take a minute.' : 'Disconnecting…'}</span>;
  const check = agent.connected && agent.check && !activity.running ? agentCheckLine(agent.check, agent.id) : null;
  const refused = state.refused(agent.id);
  return <span className="agent-detail">
    <span className="agent-status" data-connected={agent.connected} role={activity.running ? 'status' : undefined}>{line}</span>
    {check && agent.check && <span className="agent-check" data-warning={check.warning || undefined}>
      {agent.check.status === 'ready' ? <>Ready · last session <time dateTime={agent.check.at} title={absoluteDate(agent.check.at)}>{relativeDate(agent.check.at)}</time></> : withCode(check.text)}
    </span>}
    {!agent.found && !activity.running && <InstallLink agent={agent} />}
    {mode.kind !== 'connect' && !activity.running && (agent.program
      ? <span className="agent-program">Program: <span className="agent-program-path">{agent.program}</span>
        <Button variant="text" underline className="agent-install" aria-label={'Clear the program chosen for ' + agentNames[agent.id]} onClick={() => state.clearProgram(agent.id)}>Clear</Button></span>
      : !agent.found && <Button variant="text" underline className="agent-install" aria-label={'Choose program… for ' + agentNames[agent.id]} onClick={() => state.chooseProgram(agent.id)}>Choose program…</Button>)}
    {refused && <Alert tone="danger" announce className="agent-error">{refused}</Alert>}
    {activity.failed && !activity.running && <Alert tone="danger" announce className="agent-error">{activity.failed.error}</Alert>}
    {mode.kind === 'manage' && folder && <ByHand agent={agent} folder={folder} />}
  </span>;
}

/** The commands that connect the agent by hand, each with a Copy button; folded until opened. */
function ByHand({ agent, folder }: { agent: AgentState; folder: AgentFolder }) {
  const { terminal, session } = byHandCommands(agent.id, folder);
  const command = (text: string) => <li key={text}><Code>{text}</Code><CopyButton text={text} label="Copy" /></li>;
  return <Disclosure className="agent-by-hand" title="Connect by hand">
    <p>In a terminal (this installs the plugin; Connect also grants the agent Coord’s home):</p>
    <ol className="agent-commands">{terminal.map(command)}</ol>
    <p>{agent.id === 'claude' ? 'Or in a Claude Code session:' : 'Then in Codex, to see it:'}</p>
    <ol className="agent-commands">{session.map(command)}</ol>
  </Disclosure>;
}

function action(agent: AgentState, now: AgentActivity, mode: AgentListMode, state: Agents): ReactNode {
  const name = agentNames[agent.id];
  const retry = now.failed && <Button variant="secondary" onClick={() => now.failed!.action === 'connect' ? state.connect(agent.id) : state.disconnect(agent.id)}>Try again</Button>;
  if (mode.kind === 'choose') {
    return <Checkbox label="Connect" aria-label={'Connect ' + name} disabled={!agent.found} checked={agent.found && mode.chosen.includes(agent.id)} onCheckedChange={value => mode.choose(agent.id, value === true)} />;
  }
  if (mode.kind === 'connect') {
    if (now.running) return null;
    if (retry) return retry;
    return agent.connected ? <CheckIcon className="agent-done" aria-label={name + ' is connected'} role="img" /> : null;
  }
  if (!agent.found) return <Button variant="secondary" onClick={state.check}>Check again</Button>;
  const disconnect = <Button variant="secondary" pending={now.running === 'disconnect'} disabled={Boolean(now.running)} aria-label={'Disconnect ' + name} onClick={() => state.disconnect(agent.id)}>Disconnect</Button>;
  // A connect whose plugin went in but whose grant failed leaves the agent connected: it can be tried again or disconnected.
  if (retry && !now.running) return agent.connected && now.failed!.action === 'connect' ? <>{retry}{disconnect}</> : retry;
  return agent.connected
    ? disconnect
    : <Button variant="primary" pending={now.running === 'connect'} disabled={Boolean(now.running)} aria-label={'Connect ' + name} onClick={() => state.connect(agent.id)}>Connect</Button>;
}
