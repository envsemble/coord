import type { Document, LedgerStep, Work } from './types';

export function primaryDocuments(work: Work): { plan?: Document; ledger?: Document } {
  return {
    plan: work.documents.find(file => file.path === work.currentPlan),
    ledger: work.documents.find(file => file.path === work.ledger),
  };
}

export function defaultDocument(work: Work): Document | undefined {
  const { plan, ledger } = primaryDocuments(work);
  const started = ['in_progress', 'partial', 'complete'].includes(work.implementation);
  return (started ? ledger ?? plan : plan ?? ledger)
    ?? work.documents.find(file => file.name.toLowerCase() === 'readme.md') ?? work.documents[0];
}

export type StepPhase = 'planning' | 'implementation';
/**
 * A ledger step's phase: planning when its header says `phase: planning`, else implementation (as
 * every step was before ledgers had planning steps). Read defensively: the step entries may not
 * carry the phase yet.
 */
export const stepPhase = (step: LedgerStep): StepPhase => (step as LedgerStep & { phase?: unknown }).phase === 'planning' ? 'planning' : 'implementation';
