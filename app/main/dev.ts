// Coord Dev: the development app, started by `npm run dev` (scripts/dev.mjs) on a copy of the user's
// Coord data, beside the installed Coord. The launcher hands it its home (COORD_HOME) and Coord
// Dev's agent bundle (COORD_DEV_BUNDLE: the release's, renamed by scripts/dev-plugin.cjs), which the
// app installs into that home's agent folder as the installed app does with its own. Nothing here
// runs in a packaged app.
//
// - Starting, it turns its plugin (coord-dev) on in each agent found, connecting it the first time:
//   the same Connect as Settings › Agents, which in Coord Dev connects coord-dev.
// - The Dev menu copies the real data again (the app exits with refreshExitCode; the launcher copies
//   while nothing holds the copy open, and starts the app again) and removes the plugin.
// - Quitting, the launcher turns the plugin off, so its hooks run only while Coord Dev does.
import { app } from 'electron';
import type { Agents } from './agent/agents.ts';
import type { RotatingLog } from './log.ts';

/** The exit status that asks the launcher to copy the real data again and start the app again. */
export const refreshExitCode = 75;

/** Whether this is Coord Dev: an unpackaged app the launcher gave a dev bundle. */
export const isCoordDev = (packaged: boolean, environment: NodeJS.ProcessEnv) => !packaged && Boolean(environment.COORD_DEV_BUNDLE);

export interface DevActions {
  /** Turn the dev plugin on in each agent found. */
  start(): Promise<void>;
  /** Exit for the launcher to copy the real data again and start Coord Dev again. */
  refresh(): void;
  /** Take the dev plugin out of every agent it is in; the error of the first that failed, if any. */
  removePlugin(): Promise<string | null>;
}

export function devActions(agents: Agents, log: RotatingLog): DevActions {
  return {
    async start() {
      for (const agent of await agents.list()) {
        if (!agent.found || agent.connected) continue;
        const { error } = await agents.connect(agent.id);
        if (error) log.warn('Coord Dev: the dev plugin could not be turned on', { agent: agent.id, error });
        else log.info('Coord Dev: the dev plugin is on', { agent: agent.id });
      }
    },
    refresh() {
      log.info('Coord Dev: copying the real data again');
      app.exit(refreshExitCode);
    },
    async removePlugin() {
      let failed: string | null = null;
      // Turned off is not connected, but still installed: every agent found has it taken out (nothing there counts as done).
      for (const agent of await agents.list()) {
        if (!agent.found) continue;
        const { error } = await agents.disconnect(agent.id);
        failed ??= error;
      }
      return failed;
    },
  };
}
