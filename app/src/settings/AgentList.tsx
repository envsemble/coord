// The agents on this computer, one row each: its mark and name over its status, and at the end what
// can be done with it. Settings' Agents section connects and disconnects them; the onboarding uses
// the same rows to choose the agents to connect, then to connect them. Connecting or disconnecting
// one can take a while: its row shows it, and the others stay usable. An agent not on this computer
// is greyed, with a link to install it; the list checks again whenever it shows and as the window
// comes forward, so one installed meanwhile can be connected.
import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { Button, Checkbox, GroupedRows, Row, Spinner } from '@envsemble/envui';
import { agentIds, agentNames } from '../../shared/contract';
import type { AgentId, AgentState } from '../types';
import { api, AtlasError } from '../api';
import { AgentLogo } from './AgentLogo';
import { agentInstallPages, agentStatus, finished, idle, started, withAgent, type AgentActivity } from './agents';
import { CheckIcon } from '../ui/icons';

/** The agents on this computer and what is happening to each, with ways to check them again and to connect or disconnect one. */
export function useAgents() {
  const [agents, setAgents] = useState<AgentState[] | null>(null);
  const [error, setError] = useState('');
  const [activity, setActivity] = useState<Partial<Record<AgentId, AgentActivity>>>({});
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
      const cancelled = (failure as AtlasError).code === 'cancelled';
      setActivity(current => ({ ...current, [id]: finished(action, { error: cancelled ? null : (failure as Error).message }) }));
    } finally { running.current--; }
  }, []);
  return {
    agents, error, check,
    activity: (id: AgentId) => activity[id] ?? idle,
    /** Whether any agent is connecting or disconnecting now. */
    busy: Object.values(activity).some(item => item?.running),
    connect: (id: AgentId) => void run(id, 'connect'),
    disconnect: (id: AgentId) => void run(id, 'disconnect'),
  };
}
export type Agents = ReturnType<typeof useAgents>;

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
  if (agents === null) return <Spinner label="Checking the agents on this computer" />;
  const shown = agents.filter(agent => mode.kind !== 'connect' || mode.only.includes(agent.id))
    .sort((a, b) => agentIds.indexOf(a.id) - agentIds.indexOf(b.id));
  return <GroupedRows className="agent-list" aria-label={label}>{shown.map(agent => {
    const now = activity(agent.id);
    return <Row key={agent.id} className="agent-row" data-agent={agent.id} data-found={agent.found} aria-busy={now.running ? true : undefined}
      title={<span className="agent-name"><AgentLogo agent={agent.id} /><span className="row-link-title">{agentNames[agent.id]}</span></span>}
      detail={<AgentDetail agent={agent} activity={now} />}
      action={<span className="row-actions agent-actions">{action(agent, now, mode, state)}</span>} />;
  })}</GroupedRows>;
}

/** An agent's status, what is happening to it, or why the last change failed. */
function AgentDetail({ agent, activity }: { agent: AgentState; activity: AgentActivity }) {
  let line: ReactNode = agentStatus(agent);
  if (activity.running) line = <span className="agent-progress"><Spinner size="small" label="" />{activity.running === 'connect' ? 'Connecting… this can take a minute.' : 'Disconnecting…'}</span>;
  return <span className="agent-detail">
    <span className="agent-status" data-connected={agent.connected} role={activity.running ? 'status' : undefined}>{line}</span>
    {!agent.found && !activity.running && <InstallLink agent={agent} />}
    {activity.failed && !activity.running && <span className="agent-error" role="alert">{activity.failed.error}</span>}
  </span>;
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
  if (retry && !now.running) return retry;
  return agent.connected
    ? <Button variant="secondary" pending={now.running === 'disconnect'} disabled={Boolean(now.running)} aria-label={'Disconnect ' + name} onClick={() => state.disconnect(agent.id)}>Disconnect</Button>
    : <Button variant="primary" pending={now.running === 'connect'} disabled={Boolean(now.running)} aria-label={'Connect ' + name} onClick={() => state.connect(agent.id)}>Connect</Button>;
}
