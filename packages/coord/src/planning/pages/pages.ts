// A work item's pages: views an agent makes in its `pages/` folder, one folder each, on Coord's
// stack. A page's folder holds its source (an entry, `page.tsx`, and whatever it imports) and its
// data. Coord builds the page here, where its files are, and the window that shows it runs the
// build in a frame of its own, which supplies the stack (React, envUI, the diagram viewer and
// `@envsemble/coord-page`), so a page needs nothing installed.
import { readdir, readFile, realpath, stat } from 'node:fs/promises';
import path from 'node:path';

/** The files a page's folder may start from, in the order tried. */
export const pageEntries = ['page.tsx', 'page.jsx', 'page.ts', 'page.js'] as const;
/** The file a page's choices are saved in, in its folder. */
export const choicesFile = 'choices.json';
/** The file an agent says what a page needs of its user in, in its folder: `{ "attention": "…" }`. */
export const pageFile = 'page.json';

/** What a page may import beyond its own files: Coord's stack, which the window supplies. */
export const stackModule = /^(?:react(?:\/jsx-runtime|\/jsx-dev-runtime)?|react-dom(?:\/client)?|@envsemble\/envui(?:\/(?:code|markdown|diff|messages|icons\/[A-Za-z0-9]+))?|@envsemble\/coord-diagrams\/react|@envsemble\/coord-page)$/;
const stackNames = 'react, react-dom, @envsemble/envui (with its code, markdown, diff and messages entries and its icons), @envsemble/coord-diagrams/react and @envsemble/coord-page';

/** The page a planning-folder path is in, if any: its folder, relative to the planning folder. */
export function pageOf(relative: string): string | null {
  const match = /^(.+?\/pages\/[^/]+)(?:\/|$)/.exec(relative.split(path.sep).join('/'));
  return match ? match[1] : null;
}

/** Whether `child` is inside `parent`, outside hidden and build folders: where a page's files may be. */
function readable(parent: string, child: string) {
  const relative = path.relative(parent, child);
  return relative !== '' && !relative.startsWith('..') && !path.isAbsolute(relative)
    && !relative.split(path.sep).some(part => part.startsWith('.') || ['node_modules', '__pycache__', 'dist', 'build'].includes(part));
}

export interface PageProblem { file: string | null; line: number | null; column: number | null; text: string }
export type PageBuild =
  | { ok: true; code: string; css: string; imports: string[]; inputs: string[] }
  | { ok: false; problems: PageProblem[] };

async function isFile(file: string) {
  try { return (await stat(file)).isFile(); } catch { return false; }
}

/** The entry of a page's folder (absolute), or null when it has none. */
export async function pageEntry(folder: string): Promise<string | null> {
  for (const name of pageEntries) if (await isFile(path.join(folder, name))) return path.join(folder, name);
  return null;
}

/** The pages of a work folder: their names, sorted. */
export async function listPages(workFolder: string): Promise<string[]> {
  let entries;
  try { entries = await readdir(path.join(workFolder, 'pages'), { withFileTypes: true }); } catch { return []; }
  return entries.filter(entry => entry.isDirectory() && !entry.name.startsWith('.')).map(entry => entry.name).sort((a, b) => a.localeCompare(b));
}

/**
 * What a page's `page.json` says, or why it cannot be read: `attention` is what the page waits on
 * its user for (a decision, a review), until the agent clears it; null when nothing does. A page
 * without the file needs nothing.
 */
export async function readPageFile(folder: string): Promise<{ ok: true; attention: string | null } | { ok: false; problem: string }> {
  let text: string;
  try { text = await readFile(path.join(folder, pageFile), 'utf8'); } catch { return { ok: true, attention: null }; }
  let value: unknown;
  try { value = JSON.parse(text.replace(/^\uFEFF/, '')); } catch (error) { return { ok: false, problem: `${pageFile} is not JSON: ${(error as Error).message}` }; }
  if (!value || typeof value !== 'object' || Array.isArray(value)) return { ok: false, problem: `${pageFile} is an object, such as { "attention": "Pick a layout" }.` };
  const attention = (value as { attention?: unknown }).attention;
  if (attention !== undefined && attention !== null && typeof attention !== 'string') return { ok: false, problem: `${pageFile}: "attention" is the text of what the page needs of its user, or null.` };
  return { ok: true, attention: typeof attention === 'string' && attention.trim() ? attention.trim().slice(0, 500) : null };
}

/**
 * The pages that need their user's attention, by their folder (relative to the planning folder):
 * what each waits on. `folders` are the planning folder's folders, `works` its work items' paths.
 */
export async function pagesNeedingAttention(root: string, folders: readonly string[], works: readonly string[]): Promise<Record<string, string>> {
  const owners = new Set(works);
  const pages = folders.filter(folder => { const match = /^(.+)\/pages\/[^/]+$/.exec(folder); return match !== null && owners.has(match[1]); });
  const result: Record<string, string> = {};
  await Promise.all(pages.map(async page => {
    const read = await readPageFile(path.join(root, ...page.split('/')));
    if (read.ok && read.attention) result[page] = read.attention;
  }));
  return result;
}

type Esbuild = typeof import('esbuild');
let loaded: Promise<Esbuild> | null = null;
// Loaded on first use: most commands and most of the host never build a page.
const esbuild = () => loaded ??= import('esbuild');

/**
 * Build the page in `folder` (absolute; `root` is the planning folder, which problems and inputs
 * are relative to). The result is one CommonJS module, whose imports of the stack stay
 * `require` calls for the frame to answer (`imports` lists them), with the CSS it imports, and the
 * files it was built from (`inputs`). A page that does not build gives its problems instead.
 */
export async function buildPage(root: string, folder: string): Promise<PageBuild> {
  const relative = (file: string) => path.relative(root, path.resolve(folder, file)).split(path.sep).join('/');
  // A page and everything it builds from are files of the planning folder, as Coord's readers reach them.
  const resolvedRoot = await realpath(root);
  const resolvedFolder = await realpath(folder).catch(() => null);
  if (!resolvedFolder || !readable(resolvedRoot, resolvedFolder)) return { ok: false, problems: [{ file: relative('.'), line: null, column: null, text: 'A page is a folder inside the planning folder.' }] };
  const entry = await pageEntry(folder);
  if (!entry) return { ok: false, problems: [{ file: relative('.'), line: null, column: null, text: `A page starts from ${pageEntries[0]} in its folder (or ${pageEntries.slice(1).join(', ')}), exporting its component as the default.` }] };
  const { build } = await esbuild();
  const refused: PageProblem[] = [];
  try {
    const result = await build({
      entryPoints: [entry], absWorkingDir: folder, bundle: true, write: false, outdir: 'out', format: 'cjs', platform: 'browser', target: 'es2022',
      jsx: 'automatic', sourcemap: 'inline', sourcesContent: true, metafile: true, logLevel: 'silent', charset: 'utf8',
      loader: { '.json': 'json', '.css': 'css', '.svg': 'dataurl', '.png': 'dataurl', '.jpg': 'dataurl', '.jpeg': 'dataurl', '.gif': 'dataurl', '.webp': 'dataurl', '.md': 'text', '.txt': 'text', '.csv': 'text', '.puml': 'text' },
      plugins: [{
        name: 'coord-stack',
        setup(builder) {
          // Bare imports are the stack's, which the frame supplies, and nothing else.
          builder.onResolve({ filter: /^[^./]/ }, args => {
            if (path.isAbsolute(args.path) || /^[a-zA-Z]:/.test(args.path)) return undefined;
            if (stackModule.test(args.path)) return { path: args.path, external: true };
            refused.push({ file: relative(args.importer), line: null, column: null, text: `'${args.path}' is not part of Coord's stack: a page imports only ${stackNames}, and its own files.` });
            return { path: args.path, external: true };
          });
          // Files only from the planning folder: what a page imports is sent to the window that shows it.
          builder.onLoad({ filter: /.*/ }, async args => {
            const resolved = await realpath(args.path).catch(() => args.path);
            if (readable(resolvedRoot, resolved)) return undefined;
            const named = path.relative(root, args.path);
            return { errors: [{ text: `${path.isAbsolute(named) || named.startsWith('..') ? 'A file outside the planning folder' : named.split(path.sep).join('/')} is not one of the planning folder's files: a page imports only files of the planning folder.` }] };
          });
        },
      }],
    });
    if (refused.length) return { ok: false, problems: refused };
    const output = (extension: string) => result.outputFiles.find(file => file.path.endsWith(extension))?.text ?? '';
    const meta = result.metafile!;
    const imports = new Set<string>();
    for (const out of Object.values(meta.outputs)) for (const item of out.imports) if (item.external) imports.add(item.path);
    const inputs = Object.keys(meta.inputs).map(input => relative(input));
    return { ok: true, code: output('.js'), css: output('.css'), imports: [...imports].sort(), inputs };
  } catch (error) {
    const errors = (error as { errors?: { text: string; location?: { file: string; line: number; column: number } | null }[] }).errors;
    if (!errors?.length) throw error;
    return { ok: false, problems: errors.map(item => ({ file: item.location ? relative(item.location.file) : null, line: item.location?.line ?? null, column: item.location ? item.location.column + 1 : null, text: item.text })) };
  }
}
