// The onboarding, shown in place of the window on every launch until it is finished or skipped: what
// Atlas is, the agents on this computer (choosing which to connect), connecting each one chosen, and
// how to start the first session. It installs nothing until the person chooses Connect, and Settings ›
// Agents does the same any time afterwards. Back, Next and Skip are buttons; each step's heading takes
// focus as it shows, so a screen reader starts reading it.
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Button, Notice, Text } from '@envsemble/envui';
import { Code } from '@envsemble/envui/content';
import { AtlasMark } from '@envsemble/atlas-diagrams/mark';
import { agentNames } from '../../shared/contract';
import type { AgentId } from '../types';
import { api } from '../api';
import { AgentList, useAgents } from '../settings/AgentList';
import { CopyButton } from '../ui/CopyButton';
import { chosenAgents, stepFrom, stepsFor, type OnboardingStep } from './steps';

/** What the Start step suggests asking a new session. */
export const firstQuestion = 'What is Atlas and how do I use it?';

export function Onboarding({ onDone }: { onDone(): void }) {
  const agents = useAgents();
  const [step, setStep] = useState<OnboardingStep>('welcome');
  // The agents unticked, and the ones being connected (chosen as Connect was pressed).
  const [declined, setDeclined] = useState<AgentId[]>([]);
  const [connecting, setConnecting] = useState<AgentId[]>([]);
  const [finishing, setFinishing] = useState(false);
  const chosen = agents.agents ? chosenAgents(agents.agents, declined) : [];
  const steps = stepsFor(step === 'connect' || step === 'start' ? connecting : chosen);
  const heading = useRef<HTMLHeadingElement>(null);
  const first = useRef(true);
  useEffect(() => {
    // The first step's heading is read with the page; later ones take focus as they show.
    if (first.current) { first.current = false; return; }
    heading.current?.focus();
  }, [step]);

  const finish = () => {
    setFinishing(true);
    // Finished or skipped, it does not show again; a failure to record it only means it shows next time.
    api.finishOnboarding().catch(() => undefined).finally(onDone);
  };
  const next = () => {
    if (step === 'agents') {
      setConnecting(chosen);
      // Connected already, an agent is shown as it is; the others are connected now, each on its own.
      for (const id of chosen) if (!agents.agents?.find(agent => agent.id === id)?.connected && !agents.activity(id).running) agents.connect(id);
      setStep(stepFrom(step, 1, chosen) ?? 'start');
      return;
    }
    const to = stepFrom(step, 1, connecting);
    if (to) setStep(to); else finish();
  };
  const back = () => { const to = stepFrom(step, -1, step === 'agents' ? chosen : connecting); if (to) setStep(to); };

  const connected = agents.agents?.filter(agent => agent.connected).map(agent => agent.id) ?? [];
  const title = (text: string) => <Text as="h1" variant="page-heading" ref={heading} tabIndex={-1} className="onboarding-title">{text}</Text>;
  let content: ReactNode;
  if (step === 'welcome') content = <>
    <AtlasMark size={56} label="" />
    {title('Welcome to Atlas')}
    <Text>Your coding agents’ plans, and their work as it happens.</Text>
  </>;
  else if (step === 'agents') content = <>
    {title('Connect your agents')}
    <Text>Atlas installs its plugin into the agents you choose.</Text>
    {agents.error && <Notice tone="warning" announce>{agents.error}</Notice>}
    <AgentList agents={agents} mode={{ kind: 'choose', chosen, choose: (id, yes) => setDeclined(current => yes ? current.filter(item => item !== id) : [...current, id]) }} label="Agents on this computer" />
    {agents.agents && !agents.agents.some(agent => agent.found) && <Text tone="muted">Neither is installed yet: install one, then come back.</Text>}
  </>;
  else if (step === 'connect') content = <>
    {title(agents.busy ? 'Connecting your agents' : 'Your agents')}
    <AgentList agents={agents} mode={{ kind: 'connect', only: connecting }} label="Agents being connected" />
    {!agents.busy && connecting.some(id => agents.activity(id).failed) && <Text tone="muted">You can also connect it later in <strong>Settings › Agents</strong>.</Text>}
  </>;
  else content = <>
    {title('Start a session')}
    <ol className="onboarding-start">
      <li>{connected.length
        ? <>Start {connected.map(id => agentNames[id]).join(' or ')} in a new terminal, in one of your repositories.</>
        : <>Connect an agent in <strong>Settings › Agents</strong>, then start it in a new terminal.</>}</li>
      <li>
        <span>Ask it:</span>
        <span className="onboarding-question"><strong>“{firstQuestion}”</strong><CopyButton text={firstQuestion} label="Copy" /></span>
      </li>
      {(connected.includes('codex') || !connected.length) && <li>In Codex, trust the Atlas hooks once in <Code>/hooks</Code>.</li>}
    </ol>
  </>;

  const index = steps.indexOf(step);
  const nextLabel = step === 'agents' ? (chosen.length ? 'Connect' : 'Next') : step === 'start' ? 'Finish' : 'Next';
  return <main className="onboarding" aria-label="Set up Atlas">
    <div className="onboarding-card">
      <p className="onboarding-count" aria-live="polite">Step {index + 1} of {steps.length}</p>
      <div className="onboarding-progress" aria-hidden="true">{steps.map((item, at) => <span key={item} data-done={at <= index || undefined} />)}</div>
      <div className="onboarding-step" data-step={step}>{content}</div>
      <div className="onboarding-actions">
        {step !== 'start' && <Button variant="text" onClick={finish} disabled={finishing}>Skip</Button>}
        <span className="spacer" />
        {step !== 'welcome' && <Button variant="secondary" onClick={back} disabled={finishing || (step === 'connect' && agents.busy)}>Back</Button>}
        <Button variant="primary" onClick={next} pending={finishing && step === 'start'} disabled={(step === 'connect' && agents.busy) || (step === 'agents' && agents.agents === null)}>{nextLabel}</Button>
      </div>
    </div>
  </main>;
}
