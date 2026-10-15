/** Compare two paths as the platform does: case-insensitively on Windows and macOS. */
export function samePlatformPath(first: string, second: string) {
  return process.platform === 'win32' || process.platform === 'darwin' ? first.toLowerCase() === second.toLowerCase() : first === second;
}
