// What Atlas opens outside itself on this computer, beyond web pages: applications' links (a T3 Code
// thread, an editor's file), files in the chosen editor, and agent sessions resumed in a terminal.
// Each is built from a fixed form here, never from a command a page sends: an application link only
// with a scheme on the allowlist, a file only through its editor's link, and a session only as its
// harness resumes one (`claude --resume <id>`, `codex resume <id>`), run in a new terminal without a
// shell between. Pure but for `terminalFor`'s looking for terminals, so it is unit-tested.
import type { Editor } from '../../shared/contract.ts';

/**
 * Applications' links Atlas hands to the system, which opens the application that owns them: T3
 * Code's threads, editors' own links, and a few work tools'. Never `file:`, `javascript:` or a scheme
 * not listed.
 */
const appSchemes = new Set(['t3-thread:', 't3code:', 'vscode:', 'vscode-insiders:', 'cursor:', 'windsurf:', 'zed:', 'linear:', 'slack:', 'notion:', 'figma:']);

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

/** The link that opens a file (or folder) at its line in an editor; null for the system's application, which opens the file itself. */
export function editorLink(editor: Editor, file: string, line: number | null): string | null {
  if (editor === 'system') return null;
  return editor + '://file' + linkPath(file) + (line ? ':' + line : '');
}

/** A harness's resume command as words, when it is one; null for anything else. */
export function resumeWords(command: string): string[] | null {
  const match = /^(claude --resume|codex resume) ([A-Za-z0-9][A-Za-z0-9._-]{0,127})$/.exec(command);
  return match ? [...match[1].split(' '), match[2]] : null;
}

/** A program to start: its file, its arguments, and (macOS) a script it opens, written first. */
export interface Launch { file: string; args: string[]; script?: { name: string; content: string } }

/** A word for a POSIX shell, in single quotes. */
const quoted = (word: string) => "'" + word.replaceAll("'", "'\\''") + "'";

/** Linux terminals, in the order they are tried, and how each takes the command to run. */
const linuxTerminals: [string, string[]][] = [
  ['x-terminal-emulator', ['-e']], ['gnome-terminal', ['--']], ['konsole', ['-e']], ['xfce4-terminal', ['-x']], ['kitty', []], ['alacritty', ['-e']], ['xterm', ['-e']],
];

/**
 * How to run a command in a new terminal window in a folder (the program starts there): Windows
 * Terminal when it is installed, else a console window of its own; Terminal on macOS, through a
 * script that changes to the folder; on Linux the first terminal found. `has` says whether a program
 * is installed (a full path on Windows, a name on Linux). Null when no terminal is found.
 */
export function terminalFor(platform: NodeJS.Platform, folder: string, words: string[], has: (program: string) => boolean, windowsTerminal: string | null): Launch | null {
  if (platform === 'win32') {
    // cmd keeps the window open when the command ends, and finds the harness's .cmd or .exe on the PATH.
    if (windowsTerminal && has(windowsTerminal)) return { file: windowsTerminal, args: ['-d', '.', 'cmd.exe', '/k', ...words] };
    return { file: 'cmd.exe', args: ['/k', ...words] };
  }
  if (platform === 'darwin') return { file: 'open', args: ['-a', 'Terminal'], script: { name: 'atlas-resume.command', content: '#!/bin/sh\ncd ' + quoted(folder) + ' && exec ' + words.map(quoted).join(' ') + '\n' } };
  const found = linuxTerminals.find(([name]) => has(name));
  return found ? { file: found[0], args: [...found[1], ...words] } : null;
}
