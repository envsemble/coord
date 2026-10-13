export function selectModelHandle(
  models: readonly { handle: string }[],
  previous: string,
  requested = '',
  invalidHandles: readonly string[] = [],
): string {
  return requested || (models.some(model => model.handle === previous) || invalidHandles.includes(previous) ? previous : models[0]?.handle || '');
}

/** What the model picker needs to describe a model in one line. */
export interface ModelSummarySource {
  profile: string;
  state: string;
  imported: boolean;
  provenance: { kind: string; detail: string };
}

const subjects: Record<string, string> = { code: 'the code', database: 'the database' };

/**
 * One short line under a model's title in the picker: where a generated model came from and when
 * ("TypeScript · captured Sep 14, 2026"), what a proposal changes ("Changes to the code captured
 * Sep 14, 2026"), or what an authored model is ("Conceptual model").
 */
export function modelSummary(model: ModelSummarySource): string {
  const parts = model.provenance.detail.split(' · ').filter(part => part && part !== 'Imported');
  let line: string;
  if (model.provenance.kind === 'generated') {
    // The detail reads "<source kind> · <identity> · captured <date> · <coverage> coverage".
    const captured = parts.findIndex(part => part.startsWith('captured '));
    line = captured >= 0 ? [...(captured > 0 ? [parts[0]] : []), parts[captured]].join(' · ') : parts.filter(part => !part.endsWith(' coverage')).join(' · ');
  } else if (model.provenance.kind === 'proposal') {
    const date = /captured (.+)$/.exec(model.provenance.detail.replace(/ · Imported$/, ''))?.[1];
    const subject = subjects[model.profile] ?? 'the model';
    line = date ? `Changes to ${subject} captured ${date}` : `Changes to ${subject}`;
  } else line = parts.join(' · ');
  const text = model.imported ? (line ? line + ' · imported' : 'Imported') : line;
  return text.charAt(0).toUpperCase() + text.slice(1);
}
