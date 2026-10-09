---
name: atlas-bootstrap
description: Guide creation or adoption of a locally versioned planning repository, preserving existing knowledge and establishing scope, governance, and a usable index. Use when setting up the planning workflow, not for ordinary coding or independent PR babysitting. Formerly worktrail-bootstrap and planning-bootstrap.
---

# Atlas Bootstrap

Create a usable planning repository through inspection and guided decisions. A remote, template clone, initialization script, and product-repository pointer are not prerequisites. Keep local paths, repository names, and user preferences in the resulting repository rather than in the skill.

## Find the starting point

Honor an explicit location. Otherwise inspect the relevant repository/workspace context for a folder named `planning`, including a nearby sibling. Inspect candidate scope before asking about genuine ambiguity; do not scan the entire machine. If creating a folder, use the user's chosen location or a natural workspace-level `planning` folder. Ask about a consequential location or ownership choice only when context cannot resolve it. Continue independent inspection while waiting.

Read existing governance and entry points explicitly, including when entering from a sibling repository. Inspect Git status/history/remotes, the registry if present, and enough existing plans, ledgers, glossaries, ADRs, and evidence to understand the starting point. Inventory relevant surrounding repository roots and obvious output/artifact locations with the organizer workflow below. Do not mistake every Markdown file for a plan.

## Preserve before changing structure

Git is required locally. Preserve existing history and remotes. If planning is unversioned, initialize a repository at the planning root and establish a baseline of all existing plans and memories before restructuring. If it is already versioned, verify the baseline and preserve subsequent changes before moving records. Do not stage unrelated workspace changes into a parent repository. If a separate planning repository is nested in another checkout, handle the parent ownership explicitly without silently editing its configuration.

Before staging the baseline in a newly initialized repository, use the bundled [.gitattributes](assets/planning/.gitattributes) when no attributes policy exists. Its `* -text` rule preserves source bytes despite inherited line-ending conversion. Inspect existing and nested attributes; do not replace their policies. For an existing policy that transforms valuable records, retain an exact-original capture under an appropriate scoped preservation rule or byte-preserving backup before restructuring. Verify capture by restoring from Git into a disposable location and comparing SHA-256 hashes with the original-file manifest; a commit alone does not establish byte-identical recovery. For adopted plans with added metadata, compare the original bodies and attachments separately from intentional header edits.

Inspect ignored/untracked material too: a baseline commit that omits valuable records is insufficient. Preserve valuable ignored records deliberately, or use a recoverable retained copy and record where it lives. Do not silently change a user's ignore policy or commit secrets; pause only the affected preservation operation if its safe disposition needs their decision.

Make reasonable local checkpoints as maintenance progresses. Do not replace Git history, force-push, or require an origin. Adding a remote or publishing needs separate authorization.

## Establish the contract adaptively

Read the standalone assets as templates and the shared contract:

- [AGENTS.md](assets/planning/AGENTS.md): scope, reading, recording, preservation, and authority.
- [PLANS.md](assets/planning/PLANS.md): registry and plan metadata, identity, and lifecycle.
- [README.md](assets/planning/README.md): human entry points and adoption orientation.
- [planning.json](assets/planning/planning.json): empty registry.
- [plan-frontmatter.md](assets/planning/plan-frontmatter.md): minimal metadata example with a flexible body.
- [.gitattributes](assets/planning/.gitattributes): byte-preserving baseline policy for a new repository without existing attributes.

Copy missing assets to the planning root. Reconcile existing files in place; do not overwrite local governance or competing registries blindly. Adapt orientation and scope to discovered facts. Keep repository-specific rules that remain applicable, expose genuine contradictions, and remove no original knowledge merely to make the template fit. Keep the metadata example available as `plan-frontmatter.md`; it is a template, not a registered work item.

Register participating repositories using stable IDs and readable names; optional paths and remotes are discovery hints. Start from evidence and ask only about unresolved scope that affects the current work. A local path may vary by machine. Create `active/`, `archive/`, and `knowledge/` as useful content arrives; no empty work-item scaffold is required.

Index existing records before relocating them when that preserves a usable starting point. Legacy work may retain its current location and a null `current_plan` until the main plan is identified. Dates and statuses must reflect evidence, including uncertainty. Choose the next unused work number across all registered active, archived, and retained legacy work. Preserve identity on moves. Do not normalize historical prose into a mandatory body outline.

## Compose organization and finish

Load the sibling [atlas-organize](../atlas-organize/SKILL.md) and use its inspection, selective retention, and preservation workflow; bootstrap and later maintenance share that workflow. Organization must include relevant material outside planning. An existing baseline protects only the records actually captured: retain useful external contents in planning's recoverable history before moving their source. Keep the original location and destination/source links, repair affected references, and verify preservation. Inspection itself does not authorize deletion of external artifacts.

Pilot a bounded work item or copy before broad relocation. Finish enough adoption for current use rather than delaying availability until every legacy file is normalized. A usable result has local Git history, reconciled governance, repository scope, an explicit registry and entry points, and preserved originals or indexed legacy locations. Check registry pointers and links, and verify retained contents against the baseline/move mapping. For significant migration, use body/file comparisons and an actual recovery check, not document counts alone.

Use the read-only `atlas planning check <planning-root>` when checking registry and selected-plan consistency. It exits 0 when valid (warnings allowed), 1 on errors, and 2 on usage errors. It accepts the flat contract's scalar fields and flow/block lists; it does not migrate records, interpret arbitrary YAML structures, check Markdown links, or prove preservation. Legacy plans without frontmatter and unknown legacy pointers/scope are reported as warnings rather than forced normalization. If the `atlas` command is missing, the Atlas README's "Install the atlas command" section explains how to install it.

Report the usable location, what was adopted, verification evidence, and any unresolved legacy locations or genuinely blocked choices. Keep acceptance, implementation, PR readiness, merge, and release distinct. Subsequent planning-dependent operations read this repository's `AGENTS.md` and `PLANS.md`; ordinary coding and independent `atlas-babysit-pr` remain available without planning.

## Passive usage reporting

After consulting planning records, follow [passive usage reporting](references/USAGE.md) to record the actual consulted files in useful batches, with known task identity when available. Collection works while the Atlas app is closed. A missing `atlas` command or logging failure must not interrupt the authorized task.
