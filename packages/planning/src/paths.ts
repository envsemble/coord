/** Compare planning paths under the connected filesystem's case and Unicode-normalization rules. */
export function samePath(left: string, right: string, caseSensitive = true, normalizesUnicode = false) {
  if (normalizesUnicode) { left = left.normalize('NFC'); right = right.normalize('NFC'); }
  return caseSensitive ? left === right : left.toLowerCase() === right.toLowerCase();
}

interface IndexedDocument { path: string }
type Same = (left: string, right: string) => boolean;

/**
 * Resolve an Atlas context record path to an indexed planning document.
 * Paths are relative to the model's work folder (`plan.md`, `../../knowledge/glossary.md`).
 * Absolute paths, URLs and escapes above the planning root never resolve.
 */
export function resolveRecordPath<T extends IndexedDocument>(raw: unknown, workPath: string | null | undefined, documents: readonly T[], same: Same = (a, b) => samePath(a, b)): T | undefined {
  if (!workPath || typeof raw !== 'string' || !raw || raw.length > 2048 || raw.includes('\0')) return undefined;
  const clean = raw.replaceAll('\\', '/').split('#', 1)[0];
  if (!clean || clean.startsWith('/') || /^[a-z][a-z0-9+.-]*:/i.test(clean)) return undefined;
  const candidate = normalize(workPath + '/' + clean);
  return candidate === null ? undefined : documents.find(item => same(item.path, candidate));
}

function normalize(value: string): string | null {
  const parts: string[] = [];
  for (const segment of value.split('/')) {
    if (!segment || segment === '.') continue;
    if (segment === '..') { if (!parts.length) return null; parts.pop(); }
    else parts.push(segment);
  }
  return parts.length ? parts.join('/') : null;
}

/** Display a planning path relative to its work folder when it lives inside it. */
export function workRelative(documentPath: string, workPath: string | null | undefined) {
  return workPath && documentPath.startsWith(workPath + '/') ? documentPath.slice(workPath.length + 1) : documentPath;
}
