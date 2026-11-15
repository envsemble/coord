// Loaded before the unit tests (node --import): they never use the user's Coord home. Unless the
// run chose one, COORD_HOME is a new temporary folder, which test files and the commands they start
// inherit, and which is removed when the run ends.
import { mkdtempSync, rmSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import path from "node:path";

// Whatever a test does, the user's own home stays out of reach: opening it throws (see guardTestHome).
process.env.COORD_TEST_FORBIDDEN_HOME ??= path.join(homedir(), ".coord");

if (!process.env.COORD_HOME) {
  const home = mkdtempSync(path.join(tmpdir(), "coord-test-home-"));
  process.env.COORD_HOME = home;
  process.once("exit", () => {
    // The home database may still be open in this process; the system removes what is left.
    try {
      rmSync(home, { recursive: true, force: true });
    } catch {
      /* Left for the system's temporary folder cleanup. */
    }
  });
}
