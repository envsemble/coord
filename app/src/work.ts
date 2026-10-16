import type { Document, LedgerStep, Work } from './types';

export const planDocument = (work: Work): Document | undefined => work.documents.find(file => file.path === work.currentPlan);

/** What a work item's page reads: its plan, else its README, else its first document other than its ledger. */
export function defaultDocument(work: Work): Document | undefined {
  return planDocument(work)
    ?? work.documents.find(file => file.name.toLowerCase() === 'readme.md')
    ?? work.documents.find(file => file.path !== work.ledger);
}

export type StepPhase = 'planning' | 'implementation';
/**
 * A ledger step's phase: planning when its header says `phase: planning`, else implementation (as
 * every step was before ledgers had planning steps).
 */
export const stepPhase = (step: LedgerStep): StepPhase => step.phase === 'planning' ? 'planning' : 'implementation';
