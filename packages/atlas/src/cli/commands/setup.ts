// `atlas setup`: make Atlas part of every agent session on this computer. It creates the Atlas home
// and its database, grants the home to Claude Code
// (permissions.additionalDirectories) and Codex ([sandbox_workspace_write] writable_roots) so agents
// can edit planning prose from any checkout, and installs the Atlas plugin into each harness on PATH
// through the harness's own commands (src/agents, which the desktop app uses too). Running it again
// changes nothing. --dry-run only says what it would do. HOME/USERPROFILE, CLAUDE_CONFIG_DIR,
// CODEX_HOME and PATH choose what it touches.
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { atlasHome, HomeDatabase, prepareHome } from '../../planning/index.ts';
import { grantHome, harnesses, installStep, marketplaceName, onPath, userHome } from '../../agents/agents.ts';
import { parseOptions, positionals, wantsHelp, type Output } from '../args.ts';

const line = 'Usage: atlas setup [--dry-run]';
/**
 * The marketplace folder, two levels above this package, whose marketplace manifests name the
 * plugin in plugin/: the Atlas repository, or the folder the desktop app copies the command and the
 * plugin into (~/.atlas/agent, with this package in command/<version>).
 */
export const repository = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../../..');

export async function setup(args: string[], out: Output, environment: NodeJS.ProcessEnv = process.env) {
  if (wantsHelp(args)) { out.stdout(line); return 0; }
  const { positional, flags } = parseOptions(args, { values: [], flags: ['dry-run'] }, line);
  positionals(positional, [], line);
  const dryRun = flags.has('dry-run');
  let failed = false;

  const user = userHome(environment);
  const home = atlasHome(undefined, environment, user);
  if (dryRun) out.stdout(existsSync(home) ? `Atlas home: ${home}` : `Would create the Atlas home: ${home}`);
  else {
    await prepareHome({ environment, home: user });
    out.stdout(`Atlas home: ${home}`);
    // Opening the database creates it; one of another schema version is refused.
    try { HomeDatabase.open(home).close(); }
    catch (error) { failed = true; out.stderr(`atlas: the Atlas home's database could not be opened: ${(error as Error).message}`); }
  }

  const marketplace = marketplaceName(repository);
  for (const harness of harnesses) {
    const program = onPath(harness.program, environment);
    const config = harness.config(environment);
    if (!program && !existsSync(config)) { out.stdout(`${harness.name}: not found (no ${harness.program} on PATH, no ${config}); skipped.`); continue; }
    const file = path.join(config, harness.file);
    try {
      if (!(await grantHome(harness, home, environment, dryRun))) out.stdout(`${harness.name}: the home is already granted in ${file}.`);
      else out.stdout(`${harness.name}: ${dryRun ? 'would grant' : 'granted'} the home in ${file} (${harness.where}).`);
    } catch (error) {
      failed = true;
      out.stderr(`${harness.name}: ${file} was left as it is: ${(error as Error).message}.`);
    }
    if (!program) { out.stdout(`${harness.name}: ${harness.program} is not on PATH, so the Atlas plugin was not installed.`); continue; }
    for (const command of harness.install(repository, marketplace)) {
      const shown = [harness.program, ...command].join(' ');
      if (dryRun) { out.stdout('Would run: ' + shown); continue; }
      const step = await installStep(harness, program, command, marketplace, environment);
      if (step.replaced) out.stdout('Ran: ' + step.replaced + ' (it named another checkout)');
      if (step.ok) out.stdout('Ran: ' + shown + (step.already ? ' (already done)' : ''));
      else { failed = true; out.stderr(`${harness.name}: ${shown} failed (exit ${step.status}): ${step.output.split(/\r?\n/).slice(-3).join(' ')}`); }
    }
  }
  if (!dryRun && !failed) out.stdout('Atlas is set up. Start a new agent session to load the plugin.');
  return failed ? 1 : 0;
}
