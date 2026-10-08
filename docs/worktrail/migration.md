# Moving to Worktrail

Worktrail owns the planning workflow, PR babysitting and dashboard previously developed in `jakubg05/skills`. Atlas owns extraction, documents, validation, diagrams and portable output in `envsemble/atlas`. The user's existing `planning` repository stays separate; no plans, model snapshots, usage data or local secrets are imported into this source repository.

The relevant source history is retained, including earlier root-level `implement-plan` and `babysit-pr` versions and the later grouped planning workflow/dashboard. Filtering removes unrelated skills and translates `planning-workflow/` to `skills/` and `planning-dashboard/` to `dashboard/`. Authors, dates and commit messages remain; hashes change with the filtered trees and ancestry. [The commit map](history/skills-commit-map.txt) records original → extracted hashes from source head `480a2cd8026a64e4c82f251aaef83e742586ca69`. Zero entries identify commits with no retained content. Final Worktrail naming/branding changes are ordinary new commits after extraction. Atlas keeps its original commit IDs and ancestry.

| Previous installed name | Worktrail name |
| --- | --- |
| planning-bootstrap | worktrail-bootstrap |
| planning-organize | worktrail-organize |
| planning-grill | worktrail-grill |
| planning-implement / implement-plan | worktrail-implement |
| planning-record | worktrail-record |
| babysit-pr | worktrail-babysit-pr |
| atlas-modeling | worktrail-atlas |

Copy all seven new folders together. Compare existing customizations before retiring older installed folders; Worktrail does not delete or overwrite unrelated skills automatically. Sister-skill links and consultation helper paths use the new names. Invocation policies are preserved: implementation and PR babysitting are explicit-only.

Planning metadata, repository/work identities, model handles and document revisions stay compatible. Connect the existing folder with `--planning-dir`; `--atlas-dir` still defaults to that folder. The usage cache remains under `~/.cache/planning-dashboard/<canonical-folder-hash>` and `PLANNING_DASHBOARD_DATA_DIR` remains supported so renaming the application does not lose statistics. Node and Python continue using the same local SQLite store. Repository relocation alone does not rename planning identities or continuously recapture source baselines.

Distributions now use `worktrail-<version>-<commit>.zip` and the `worktrail/release` manifest format. Previous planning ZIPs remain historical source distributions; they are not Atlas documents and no importer depends on their filename. Both products remain private/UNLICENSED, with retained upstream attribution; no public-license decision is implied.
