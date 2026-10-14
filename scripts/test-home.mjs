// Loaded before the unit tests (node --import): they never use the user's Atlas home. Unless the
// run chose one, ATLAS_HOME is a new temporary folder, which test files and the commands they start
// inherit, and which is removed when the run ends.
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

if (!process.env.ATLAS_HOME) {
  const home = mkdtempSync(path.join(tmpdir(), "atlas-test-home-"));
  process.env.ATLAS_HOME = home;
  process.once("exit", () => rmSync(home, { recursive: true, force: true }));
}
