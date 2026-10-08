# Contributing to Worktrail

Keep planning records, lifecycle decisions and reported outcomes in the associated planning repository. Skills assist that workflow; the dashboard remains a read-only local viewer. Atlas owns semantic model/capture/validation/layout behavior; this repository consumes its canonical commit/hash-pinned package rather than copying a renderer.

Use Python 3 with `requirements-dev.txt` for workflow tests and Node 24/npm for the dashboard. Run the commands in [README](README.md#check-and-package) and `npm test` / `npm run build` in `dashboard`. Meaningful fixtures should preserve existing records, containment, scope and actual consultation evidence.

To refresh Atlas, commit and validate its source, run `npm run atlas:package -- /path/to/atlas` in the dashboard, then `npm install` and both dashboard checks. Commit the vendor tarball, manifest and lockfile together. Screenshots in `dashboard/assets` must show actual UI and retain useful alt text. Source assets follow their existing owner/license; no blanket public license is introduced here.

Review artifacts and release ZIPs are CI outputs. Required GitHub checks are `CI` and `Betterleaks`; the scanner is version/hash-pinned and scans retained Git history. Human merge and any publishing/deployment remain explicit decisions. Preserve the [migration history](docs/migration.md), source attribution and compatible local planning/usage identities.
