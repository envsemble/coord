# Planning

This locally versioned repository, in the Atlas home, is an Atlas project: it holds intended work, implementation records, historical rationale, and scoped engineering knowledge for the folders it covers. Its name is the `name` in `planning.json`.

Start with [AGENTS.md](AGENTS.md) for governance and [PLANS.md](PLANS.md) for work identity, metadata, and lifecycle. [planning.json](planning.json) is the authoritative index of the project's folders and work. [plan-frontmatter.md](plan-frontmatter.md) is the minimal metadata example; plan bodies remain flexible.

## Folders

The project is this planning folder and the folders it covers on this computer, listed in `planning.json` (`folders`): a session in one of them, or inside one, belongs to this project, and so does a session in this planning folder. Atlas keeps no repositories: the same repository may be checked out in several folders, and agents name the repository a reference is about themselves (`owner/repo#12`, `owner/repo@4ab195a`). Sharing this planning repository does not share every repository's constraints.

## Work and knowledge

- `active/` holds discussion, planning, implementation, and other work expected to resume.
- `archive/` holds accessible completed or deliberately closed work with its original supporting documents.
- `knowledge/` holds selective, scoped lessons, decisions, and observations useful beyond one work item, linked to their origins.

Work items are created, started, closed and archived through the Atlas tools, which allocate their numbers and keep the registry current. Use registry entries to find current work; folder numbers and the newest filenames do not establish design authority. Current code, tests, and canonical product documentation establish present reality. Plans preserve intent and rationale.

## Existing records

Keep a compact account here or in an appropriate evidence record when there are significant imports, original-to-retained mappings, or unresolved candidates; do not list every discarded routine log.

Preserve a local Git baseline before restructuring. In a new repository without an existing attributes policy, [.gitattributes](.gitattributes) captures original bytes despite inherited line-ending conversion. Preserve existing policies and verify exact-original recovery against file hashes before moves. Relevant material outside planning may be inspected and selectively retained with scope and provenance; capture valuable external contents in planning's recoverable history before moving the source. Preserve bodies, attachments, and links. A remote is optional; setup does not publish this repository.
