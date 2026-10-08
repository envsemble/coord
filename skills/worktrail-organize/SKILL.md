---
name: worktrail-organize
description: Organize an existing planning repository and retain valuable plans, ledgers, decisions, and evidence scattered around its workspace. Use for planning maintenance, adoption of legacy records, and selective recovery from root-level artifacts.
---

# Organize planning

Make useful information discoverable while preserving its meaning and provenance. Read [the organization workflow](references/organization.md); it is also the workflow used by `worktrail-bootstrap` after initialization.

Find the relevant folder named `planning` in the workspace or use the supplied location. Read its `AGENTS.md`, `PLANS.md`, and registry explicitly. Scope searches by participating repositories and the task. If the folder is missing or not yet usable, guide setup through [worktrail-bootstrap](../worktrail-bootstrap/SKILL.md) before the planning operation. Independent coding does not depend on this prerequisite.

Start from the existing conventions and content. Use the bootstrap [governance assets](../worktrail-bootstrap/assets/planning/AGENTS.md) and [metadata contract](../worktrail-bootstrap/assets/planning/PLANS.md) when missing contracts need to be adopted, preserving local instructions and surfacing substantive conflicts. Do not overwrite established governance from a template.

Organization includes relevant surrounding workspace and repository roots, obvious artifact/output locations, and user-identified sources. Choose what to inspect based on filenames, task context, and evidence. Preserve useful external records or extract their valuable evidence with source context; leave repetitive logs and reproducible scratch output out of durable knowledge.

Use reversible structural changes autonomously when their meaning is clear. Preserve original plans and supporting documents, establish recovery before moves, repair references, and retain uncertainty about historical status. Ask about real competing designs or ambiguous ownership while continuing independent organization.

Finish with useful entry points, an accurate registry, verified preservation, and a concise account of significant changes or unresolved items. Commit planning changes reasonably and incrementally. Product Git history and disposable-output cleanup are separate from planning maintenance.

## Passive usage reporting

After consulting planning records, follow [passive usage reporting](../worktrail-bootstrap/references/USAGE.md) to record the actual consulted files in useful batches, with known task identity when available. Collection works while the dashboard is closed. A missing helper or logging failure must not interrupt the authorized task.
