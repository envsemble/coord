import type { Document, Work } from './types';

export function relativeDocumentPath(file: Document): string {
  return file.workId ? file.key.slice(file.workId.length + 1) : file.path;
}

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
