// What Atlas opens outside itself on this computer, beyond web pages: applications' links (a T3 Code
// thread) and files in the chosen editor. Each is built from a fixed form here, never from a command
// a page sends: an application link only with a scheme on the allowlist, a file only through its
// editor's link. Pure, so it is unit-tested.
import type { Editor } from '../../shared/contract.ts';

/**
 * Applications' links a page may hand to the system, which opens the application that owns them:
 * T3 Code's threads. Never `file:`, `javascript:`, an editor's or any other application's scheme;
 * main builds editors' links itself (`editorLink`).
 */
const appSchemes = new Set(['t3-thread:', 't3code:']);

/** An application's link as the system gets it, or null when its scheme is not allowed or it does not parse. */
export function appLink(value: string): string | null {
  try {
    const url = new URL(value);
    return appSchemes.has(url.protocol) && !/[\u0000-\u001f\u007f]/.test(value) ? url.href : null;
  } catch { return null; }
}

/** A full path as an editor's link takes it: forward slashes, each part escaped, a drive letter kept. */
function linkPath(file: string) {
  const slashed = file.replaceAll('\\', '/');
  const parts = slashed.split('/').map(encodeURIComponent).join('/');
  return (parts.startsWith('/') ? parts : '/' + parts).replace(/^\/([A-Za-z])%3A/, '/$1:');
}

/** The link that opens a file at its line in an editor; null for the system's application, which Atlas only shows the file in its folder for. */
export function editorLink(editor: Editor, file: string, line: number | null): string | null {
  if (editor === 'system') return null;
  return editor + '://file' + linkPath(file) + (line ? ':' + line : '');
}
