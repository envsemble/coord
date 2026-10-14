# Planning

This locally versioned repository, in the Atlas home, holds intended work, implementation records, historical rationale, and scoped engineering knowledge for participating projects.

Start with [AGENTS.md](AGENTS.md) for governance and [PLANS.md](PLANS.md) for work identity, metadata, and lifecycle. [planning.json](planning.json) is the authoritative scope/location index and explicit current-plan selector. [plan-frontmatter.md](plan-frontmatter.md) is the minimal metadata example; plan bodies remain flexible.

## Participating projects

Repository IDs and names are listed in `planning.json`. Each repository's Git remote is how Atlas finds this folder from a checkout of it; optional checkout paths may differ between machines. Register the projects whose work belongs here as scope becomes known; sharing this repository does not share every project's constraints.

## Work and knowledge

- `active/` holds discussion, planning, implementation, and other work expected to resume.
- `archive/` holds accessible completed or deliberately closed work with its original supporting documents.
- `knowledge/` holds selective, scoped lessons, decisions, and observations useful beyond one work item, linked to their origins.

Work items are created, started, closed and archived through the Atlas tools, which allocate their numbers and keep the registry current. Use registry entries to find current work; folder numbers and the newest filenames do not establish design authority. Current code, tests, and canonical product documentation establish present reality. Plans preserve intent and rationale.

## Adoption and retained legacy locations

During adoption, existing records can remain at their original locations inside this repository and be indexed in `planning.json` before relocation. A null current-plan pointer or empty legacy scope records uncertainty rather than guessing. Keep a compact adoption account here or in an appropriate evidence record when there are significant imports, original-to-retained mappings, or unresolved candidates; do not list every discarded routine log.

Preserve a local Git baseline before restructuring. In a new repository without an existing attributes policy, [.gitattributes](.gitattributes) captures original bytes despite inherited line-ending conversion. Preserve existing policies and verify exact-original recovery against file hashes before moves. Relevant material outside planning may be inspected and selectively retained with scope and provenance; capture valuable external contents in planning's recoverable history before moving the source. Preserve bodies, attachments, and links. A remote is optional; setup does not publish this repository.
