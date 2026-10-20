// What every command shares: where it writes, its usage errors, and its option parser.

export interface Output { stdout: (text: string) => void; stderr: (text: string) => void }

/** A mistake in how the command was called: exit 2 with the usage line. */
export class UsageError extends Error {
  line: string;
  constructor(message: string, line = '') { super(message); this.line = line; }
}

export const wantsHelp = (args: string[]) => args.length === 1 && ['--help', '-h', 'help'].includes(args[0]);

/** Parse `--name value`, `--name=value` and the variadic `--files a b c`, like the former argparse helpers. */
export function parseOptions(args: string[], spec: { values: string[]; lists?: string[]; flags?: string[] }, line: string) {
  const positional: string[] = [];
  const values: Record<string, string> = {};
  const flags = new Set<string>();
  const lists: Record<string, string[]> = {};
  for (let index = 0; index < args.length; index++) {
    const argument = args[index];
    if (!argument.startsWith('--') || argument === '--') { positional.push(argument); continue; }
    const [name, inline] = argument.slice(2).split(/=(.*)/s, 2) as [string, string | undefined];
    if (spec.flags?.includes(name)) {
      if (inline !== undefined) throw new UsageError(`argument --${name}: takes no value`, line);
      flags.add(name);
    } else if (spec.lists?.includes(name)) {
      const items = inline !== undefined ? [inline] : [];
      while (index + 1 < args.length && !args[index + 1].startsWith('-')) items.push(args[++index]);
      if (!items.length) throw new UsageError(`argument --${name}: expected at least one argument`, line);
      (lists[name] ??= []).push(...items);
    } else if (spec.values.includes(name)) {
      const value = inline ?? args[++index];
      if (value === undefined || (inline === undefined && value.startsWith('--'))) throw new UsageError(`argument --${name}: expected one argument`, line);
      values[name] = value;
    } else throw new UsageError('unrecognized arguments: ' + argument, line);
  }
  return { positional, values, lists, flags };
}

/** Exactly the positional arguments `names` lists, which the error names when some are missing. */
export function positionals(positional: string[], names: string[], line: string) {
  if (positional.length > names.length) throw new UsageError('unrecognized arguments: ' + positional.slice(names.length).join(' '), line);
  if (positional.length < names.length) throw new UsageError('the following arguments are required: ' + names.slice(positional.length).join(', '), line);
  return positional;
}
