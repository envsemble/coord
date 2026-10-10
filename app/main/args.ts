import path from 'node:path';

/**
 * Folder paths on a command line (`Atlas C:\work\planning`, "Open with", or a second instance).
 * Skips the executable, the app path when Electron runs an unpackaged app, and every switch
 * (Chromium and inspector switches start with "-").
 */
export function folderArguments(argv: readonly string[], cwd: string, unpackaged: boolean): string[] {
  return argv.slice(unpackaged ? 2 : 1)
    .filter(value => value && !value.startsWith('-'))
    .map(value => path.resolve(cwd, value.replace(/^"(.*)"$/, '$1')));
}
