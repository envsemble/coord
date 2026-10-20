// Reading a repository's state without starting Git where its files tell it: the commit HEAD names,
// from `.git` (a folder, or a file naming one, as worktrees and submodules have), through loose and
// packed references. Git is asked once per repository to confirm what the files say, and whenever
// they say something unusual (a reference format they do not cover, an unborn branch); its answer
// is then the one used. Where the top level of a folder's repository is, Git is asked once while
// the folder's Git data stays where it is. A repository's remotes come from its configuration file
// when nothing could rewrite or add to them.
import { lstat, readdir, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { ProgramError, runProgram } from './run.ts';

const commitPattern = /^[0-9a-f]{40}(?:[0-9a-f]{24})?$/;
/** Environment variables that move a repository away from where its files are. */
const relocating = ['GIT_DIR', 'GIT_WORK_TREE', 'GIT_COMMON_DIR', 'GIT_INDEX_FILE', 'GIT_OBJECT_DIRECTORY'];
const cacheLimit = 1000;

/** The folder's own Git data: its `.git` folder, or the folder its `.git` file names. Null without one, or when the environment moves it. */
export async function gitDirectory(folder: string): Promise<string | null> {
  if (relocating.some(name => process.env[name])) return null;
  const dotGit = path.join(folder, '.git');
  const information = await lstat(dotGit).catch(() => null);
  if (information?.isDirectory()) return dotGit;
  if (!information?.isFile()) return null;
  const pointer = /^gitdir: (.+?)\s*$/m.exec(await readFile(dotGit, 'utf8').catch(() => ''))?.[1];
  return pointer ? path.resolve(folder, pointer) : null;
}

/** A reference's commit from the files: loose (in the worktree's folder, then the shared one), then packed. Null when the files cannot tell. */
async function reference(gitDir: string, common: string, name: string, depth = 0): Promise<string | null> {
  if (depth > 5 || (name !== 'HEAD' && (!/^refs\/[^\s\\:]+$/.test(name) || name.split('/').some(part => part === '..' || part === '.' || part === '')))) return null;
  for (const folder of name === 'HEAD' || gitDir === common ? [gitDir] : [gitDir, common]) {
    let text: string;
    try { text = (await readFile(path.join(folder, name), 'utf8')).trim(); } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT' || (error as NodeJS.ErrnoException).code === 'ENOTDIR') continue;
      return null;
    }
    if (commitPattern.test(text)) return text;
    const target = /^ref: (\S+)$/.exec(text)?.[1];
    return target ? reference(gitDir, common, target, depth + 1) : null;
  }
  if (name === 'HEAD') return null;
  const packed = await readFile(path.join(common, 'packed-refs'), 'utf8').catch(() => '');
  for (const line of packed.split('\n')) {
    const [commit, packedName] = line.trim().split(' ');
    if (packedName === name && commitPattern.test(commit)) return commit;
  }
  return null;
}

/** HEAD's commit as the repository's files give it; null when they cannot tell. */
async function headFromFiles(gitDir: string): Promise<string | null> {
  const common = await readFile(path.join(gitDir, 'commondir'), 'utf8').then(value => path.resolve(gitDir, value.trim()), () => gitDir);
  return reference(gitDir, common, 'HEAD');
}

const askHead = (folder: string) => runProgram('git', ['-C', folder, 'rev-parse', 'HEAD'], { windowsHide: true, timeout: 20000 }).then(result => result.stdout.trim() || null, () => null);
/** Git data folders whose files gave the commit Git gives (true), or another (false). */
const confirmed = new Map<string, Promise<boolean>>();

/** The commit HEAD names in the repository a folder is in, as `git rev-parse HEAD` gives it; null without one. */
export async function headCommit(folder: string): Promise<string | null> {
  const gitDir = await gitDirectory(folder);
  const fromFiles = gitDir ? await headFromFiles(gitDir) : null;
  if (!gitDir || !fromFiles) return askHead(folder);
  let check = confirmed.get(gitDir);
  if (!check) {
    if (confirmed.size >= cacheLimit) confirmed.delete(confirmed.keys().next().value!);
    check = askHead(folder).then(asked => asked === fromFiles);
    confirmed.set(gitDir, check);
  }
  return await check ? fromFiles : askHead(folder);
}

let sharedRewrites: { at: number; value: Promise<boolean> } | null = null;
/** Whether the configuration beyond a repository's own (global, system) may rewrite or add remotes: `insteadOf`, remotes, includes. Asked once a minute. */
function sharedConfigurationRewrites(): Promise<boolean> {
  if (!sharedRewrites || Date.now() - sharedRewrites.at > 60_000) {
    sharedRewrites = { at: Date.now(), value: runProgram('git', ['-C', tmpdir(), 'config', '--get-regexp', '^(url\\..*\\.(insteadof|pushinsteadof)|remote\\..*|include\\..*|includeif\\..*)$'], { windowsHide: true, timeout: 10000 })
      .then(result => result.stdout.trim() !== '', (error: unknown) => !(error instanceof ProgramError && error.code === 1)) };
  }
  return sharedRewrites.value;
}
/**
 * The fetch URL of each remote of the repository whose top level is `folder`, read from its
 * configuration file, as `git remote -v` gives them. Null when the file cannot tell for certain:
 * no repository there, configuration Git would rewrite or add to (`insteadOf`, includes, remotes in
 * the global or system configuration), or syntax this reading does not cover.
 */
export async function remoteUrls(folder: string): Promise<string[] | null> {
  const gitDir = await gitDirectory(folder);
  if (!gitDir) return null;
  const common = await readFile(path.join(gitDir, 'commondir'), 'utf8').then(value => path.resolve(gitDir, value.trim()), () => gitDir);
  // Remotes may also be files in the older `remotes` and `branches` folders.
  const older = async (name: string) => ((await readdir(path.join(common, name)).catch(() => [])) as string[]).length > 0;
  const [text, shared, remotesFolder, branchesFolder] = await Promise.all([readFile(path.join(common, 'config'), 'utf8').catch(() => null), sharedConfigurationRewrites(), older('remotes'), older('branches')]);
  if (text === null || shared || remotesFolder || branchesFolder || /insteadof|^\s*\[\s*include/im.test(text)) return null;
  const urls = new Map<string, string>();
  let remote: string | null = null;
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#') || trimmed.startsWith(';')) continue;
    if (trimmed.startsWith('[')) {
      const section = /^\[\s*([A-Za-z0-9.-]+)(?:\s+"([^"\\]*)")?\s*\]$/.exec(trimmed);
      if (!section || section[1].includes('.') || (section[1].toLowerCase() === 'remote' && section[2] === undefined)) return null;
      remote = section[1].toLowerCase() === 'remote' ? section[2] : null;
      continue;
    }
    if (remote === null) continue;
    const entry = /^([A-Za-z][A-Za-z0-9-]*)\s*(?:=\s*(.*))?$/.exec(trimmed);
    if (!entry) return null;
    if (entry[1].toLowerCase() !== 'url') continue;
    const value = entry[2];
    if (value === undefined || /["\\#;]/.test(value)) return null;
    if (!urls.has(remote)) urls.set(remote, value.trim());
  }
  return [...urls.values()];
}

const topLevels = new Map<string, Promise<string | null>>();
/**
 * The top level of the repository a folder is in, as `git rev-parse --show-toplevel` gives it; null
 * outside one. Asked again only when the folder's own Git data appears, moves or goes.
 */
export async function topLevel(folder: string): Promise<string | null> {
  const gitDir = await gitDirectory(folder);
  const key = folder + '\0' + (gitDir ?? '');
  let value = topLevels.get(key);
  if (!value) {
    if (topLevels.size >= cacheLimit) topLevels.delete(topLevels.keys().next().value!);
    value = runProgram('git', ['-C', folder, 'rev-parse', '--show-toplevel'], { windowsHide: true, timeout: 20000 }).then(result => result.stdout.trim() || null, () => null);
    topLevels.set(key, value);
    // A repository Git could not read this time (busy, or slow) is asked again next time.
    void value.then(found => { if (!found && gitDir) topLevels.delete(key); });
  }
  return value;
}
