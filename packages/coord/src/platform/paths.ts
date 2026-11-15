/** Compare planning paths under the connected filesystem's case and Unicode-normalization rules. */
export function samePath(left: string, right: string, caseSensitive = true, normalizesUnicode = false) {
  if (normalizesUnicode) { left = left.normalize('NFC'); right = right.normalize('NFC'); }
  return caseSensitive ? left === right : left.toLowerCase() === right.toLowerCase();
}

/** Display a planning path relative to its work folder when it lives inside it. */
export function workRelative(documentPath: string, workPath: string | null | undefined) {
  return workPath && documentPath.startsWith(workPath + '/') ? documentPath.slice(workPath.length + 1) : documentPath;
}
