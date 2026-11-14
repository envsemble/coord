// coord capture: write a capture of code or a database, described by a source configuration file,
// into a work item's diagrams/ folder (or a file of its own), optionally comparing with an earlier
// capture so the app shows the system before and after a plan's implementation.
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { localDate, resolvePlanningFolder, workStatus } from '../../planning/index.ts';
import { parseOptions, positionals, UsageError, wantsHelp, type Output } from '../args.ts';

export const captureUsage = 'Usage: coord capture <source.json> (--work <work-id> | --out <file>) [--name <name>] [--compares <capture.puml>] [--force] [--planning-dir <dir>]';

/** A capture that could not be written: exit 1 with the reason. */
export class CaptureError extends Error {}

export async function capture(args: string[], out: Output) {
  if (wantsHelp(args)) { out.stdout(captureUsage); return 0; }
  const { positional, values, flags } = parseOptions(args, { values: ['work', 'out', 'name', 'compares', 'planning-dir'], flags: ['force'] }, captureUsage);
  const [source] = positionals(positional, ['source.json'], captureUsage);
  if (!values.work === !values.out) throw new UsageError(values.work ? 'give either --work or --out, not both' : 'the following arguments are required: --work or --out', captureUsage);
  if (values.out && values.name) throw new UsageError('argument --name: --out already names the file', captureUsage);
  if (values.name !== undefined && !/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(values.name)) throw new UsageError('argument --name: expected letters, digits, dots, dashes and underscores', captureUsage);
  const config = path.resolve(source);
  let identity: unknown;
  try { identity = JSON.parse(readFileSync(config, 'utf8').replace(/^\uFEFF/, '')).identity; }
  catch { throw new CaptureError(`${config} cannot be read as a JSON source configuration.`); }
  let file: string, work: string | null = null;
  if (values.out) file = path.resolve(values.out);
  else {
    work = values.work!;
    const root = await resolvePlanningFolder({ planningFolder: values['planning-dir'], cwd: process.cwd(), work });
    const status = await workStatus(root, work);
    const name = values.name ?? `${typeof identity === 'string' ? identity : 'capture'}-${localDate()}`;
    file = path.join(root, status.path, 'diagrams', name + '.puml');
  }
  if (existsSync(file) && !flags.has('force')) throw new CaptureError(`${file} already exists. Choose another ${values.out ? '--out file' : '--name'}, or pass --force to replace it.`);
  // The earlier capture, by its path from here or from the folder the capture goes to.
  let earlier: string | null = null;
  if (values.compares) {
    earlier = [path.resolve(values.compares), path.resolve(path.dirname(file), values.compares)].find(candidate => existsSync(candidate)) ?? null;
    if (!earlier) throw new CaptureError(`${values.compares} does not exist; name the earlier capture by its path.`);
    if (path.relative(file, earlier) === '') throw new CaptureError(`${values.compares} is the file this capture writes; a capture compares with an earlier capture in another file.`);
  }
  const { default: diagrams } = await import('@envsemble/coord-diagrams');
  let text: string;
  try { text = await diagrams.captureFromConfig(config); }
  catch (error) { throw new CaptureError((error as Error).message); }
  if (earlier) {
    const reference = path.relative(path.dirname(file), earlier).split(path.sep).join('/');
    const { diagram } = diagrams.parseDiagram(text);
    text = diagrams.formatDiagram({ ...diagram!, compares: reference });
    // The diagrams it names, relative to the capture, which it is about to be.
    const read = (name: string) => {
      const target = path.resolve(path.dirname(file), name);
      if (path.relative(file, target) === '') return text;
      try { return readFileSync(target, 'utf8'); } catch { return null; }
    };
    const problems = diagrams.checkDiagram(text, { path: path.basename(file), read }).filter(p => p.severity === 'error');
    if (problems.length) throw new CaptureError(problems.map(p => p.message).join(' '));
  }
  const { diagram } = diagrams.parseDiagram(text);
  mkdirSync(path.dirname(file), { recursive: true });
  const temporary = file + '.' + randomUUID() + '.tmp';
  try { writeFileSync(temporary, text, { flag: 'wx' }); renameSync(temporary, file); }
  finally { rmSync(temporary, { force: true }); }
  const captured = diagram!.capture!;
  out.stdout(JSON.stringify({
    file, work, title: diagram!.title, kind: diagram!.kind, compares: diagram!.compares,
    capturedAt: captured.capturedAt, adapter: captured.adapter.id, coverage: captured.coverage.status, diagnostics: captured.coverage.diagnostics.length,
    elements: diagram!.elements.length, relations: diagram!.relations.length,
  }));
  return 0;
}
