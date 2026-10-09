// Provenance taxonomy shared with Atlas (`describeProvenance`): identical labels and detail lines.
export type ProvenanceKind = 'generated' | 'proposal' | 'authored' | 'unknown';
export type ProvenanceTone = 'accent' | 'done' | 'success' | 'neutral';
export interface Provenance { kind: ProvenanceKind; label: string; detail: string; tone: ProvenanceTone }
export interface ProvenanceSource {
  state?: string; profile?: string; imported?: boolean; baselineId?: string | null;
  snapshots?: readonly { id: string; capture?: { capturedAt?: string; source?: { kind?: string; identity?: string }; coverage?: { status?: string } } }[];
}

const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const sourceKinds: Record<string, string> = {
  typescript: 'TypeScript', javascript: 'JavaScript', java: 'Java', sqlite: 'SQLite', postgres: 'PostgreSQL',
  postgresql: 'PostgreSQL', d1: 'Cloudflare D1', mysql: 'MySQL',
};

/** "Mon D, YYYY" in UTC, so the server and browser render the same capture date. */
export function captureDate(value: string | undefined): string {
  const time = value ? Date.parse(value) : NaN;
  if (!Number.isFinite(time)) return '';
  const date = new Date(time);
  return `${months[date.getUTCMonth()]} ${date.getUTCDate()}, ${date.getUTCFullYear()}`;
}
function sourceKind(kind: string | undefined) {
  if (!kind) return '';
  return sourceKinds[kind.toLowerCase()] ?? kind.charAt(0).toUpperCase() + kind.slice(1);
}

export function describeProvenance(document: ProvenanceSource | null | undefined): Provenance {
  if (!document) return { kind: 'unknown', label: '', detail: '', tone: 'neutral' };
  const snapshots = document.snapshots ?? [];
  const capture = (snapshots.find(item => item.id === document.baselineId) ?? snapshots[0])?.capture;
  const captured = captureDate(capture?.capturedAt);
  let result: Provenance;
  if (document.state === 'snapshot') {
    const label = document.profile === 'database' ? 'Generated from database' : document.profile === 'code' ? 'Generated from code' : 'Generated from source';
    const coverage = capture?.coverage?.status;
    const detail = [sourceKind(capture?.source?.kind), capture?.source?.identity, captured && 'captured ' + captured, coverage && coverage + ' coverage'].filter(Boolean).join(' · ');
    result = { kind: 'generated', label, detail, tone: 'accent' };
  } else if (document.state === 'proposal') {
    result = { kind: 'proposal', label: 'Agent proposal', detail: captured ? 'Changes to source captured ' + captured : '', tone: 'done' };
  } else if (document.state === 'authored') {
    result = { kind: 'authored', label: 'Agent-authored', detail: document.profile === 'ontouml' ? 'Conceptual model' : 'Structural model', tone: 'success' };
  } else {
    result = { kind: 'unknown', label: '', detail: '', tone: 'neutral' };
  }
  if (document.imported) result.detail = result.detail ? result.detail + ' · Imported' : 'Imported';
  return result;
}
