// The onboarding's steps: Welcome (what Atlas is), Agents (the agents on this computer, choosing
// which to connect), Connect (connecting each one chosen) and Start (the first session). With no
// agent chosen there is nothing to connect, and Agents leads straight to Start.
import type { AgentId, AgentState } from '../types';

export const onboardingSteps = ['welcome', 'agents', 'connect', 'start'] as const;
export type OnboardingStep = typeof onboardingSteps[number];

/** The steps shown, in order, for the agents chosen. */
export const stepsFor = (chosen: readonly AgentId[]): OnboardingStep[] => onboardingSteps.filter(step => step !== 'connect' || chosen.length > 0);

/** The step after this one (Next) or before it (Back); null past either end. */
export function stepFrom(step: OnboardingStep, by: -1 | 1, chosen: readonly AgentId[]): OnboardingStep | null {
  const shown = stepsFor(chosen);
  let index = onboardingSteps.indexOf(step) + by;
  while (onboardingSteps[index] && !shown.includes(onboardingSteps[index])) index += by;
  return onboardingSteps[index] ?? null;
}

/**
 * The agents chosen as the agent list arrives or is checked again: those found on this computer
 * start ticked, an agent found later is ticked as it appears, and one no longer found is dropped.
 * What the person unticked stays unticked (`declined`).
 */
export function chosenAgents(agents: readonly AgentState[], declined: readonly AgentId[]): AgentId[] {
  return agents.filter(agent => agent.found && !declined.includes(agent.id)).map(agent => agent.id);
}
