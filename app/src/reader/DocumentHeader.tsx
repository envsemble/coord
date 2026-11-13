// A document's metadata header (its YAML block between `---` lines), as a table above its text, so a
// file opened from the planning folder shows all of itself: a plan's statuses and dates, a ledger's steps.
import { DescriptionList } from '@envsemble/envui';

type Value = unknown;

/** A value as text: lists of plain values joined, null as null. */
function plain(value: Value): string {
  if (value === null || value === undefined) return 'null';
  if (Array.isArray(value)) return value.length ? value.map(plain).join(', ') : '[]';
  if (typeof value === 'object') return JSON.stringify(value);
  return String(value);
}

/** A field's value: a list of entries (a ledger's steps) one per line, anything else as text. */
function FieldValue({ value }: { value: Value }) {
  if (Array.isArray(value) && value.some(item => item && typeof item === 'object' && !Array.isArray(item))) {
    return <ol className="document-header-entries">{value.map((item, index) =>
      <li key={index}>{item && typeof item === 'object' && !Array.isArray(item) ? Object.entries(item).map(([key, entry]) => key + ': ' + plain(entry)).join(' · ') : plain(item)}</li>)}</ol>;
  }
  return <>{plain(value)}</>;
}

export function DocumentHeader({ metadata }: { metadata: Record<string, unknown> }) {
  const fields = Object.entries(metadata);
  if (!fields.length) return null;
  return <DescriptionList.Root className="document-header" layout="inline" size="sm" aria-label="Metadata header">
    {fields.map(([field, value]) => <DescriptionList.Item key={field} label={field}><FieldValue value={value} /></DescriptionList.Item>)}
  </DescriptionList.Root>;
}
