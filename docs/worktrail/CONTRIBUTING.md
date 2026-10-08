# Planning workflow and dashboard contributions

Keep planning records, lifecycle decisions and reported outcomes in the associated planning repository. Skills assist that workflow; the dashboard remains a read-only local viewer. Atlas owns semantic model/capture/validation/layout behavior; this repository consumes its canonical commit/hash-pinned package rather than copying a renderer.

Use Python 3 with `requirements-dev.txt` for workflow tests and Node 24/npm for the dashboard. Run the commands in [README](README.md#validation) and `npm test` / `npm run build` in `planning-dashboard`. Meaningful fixtures should preserve existing records, containment, scope and actual consultation evidence. Do not change unrelated skills while adjusting planning integration.

To refresh Atlas, commit and validate its source, run `npm run atlas:package -- /path/to/atlas` in the dashboard, then `npm install` and both dashboard checks. Commit the vendor tarball, manifest and lockfile together. Screenshots in `planning-dashboard/assets` must show actual UI and retain useful alt text. Source assets follow their existing owner/license; no blanket public license is introduced here.

Review artifacts and release ZIPs are CI outputs, not deployments or public releases. Human review/merge and any later repository separation remain explicit decisions.
