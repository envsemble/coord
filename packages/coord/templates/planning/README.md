# Planning

This Git repository, in the Coord home, is an Coord project: its work items, each a plan with its steps. Its name is the `name` in `planning.json`.

[AGENTS.md](AGENTS.md) says how agents work here, [PLANS.md](PLANS.md) defines the plan, registry and ledger formats, and [planning.json](planning.json) lists the project's folders and work. [plan-frontmatter.md](plan-frontmatter.md) is an example plan header.

## Folders

The project covers the folders listed in `planning.json` (`folders`): a session in one of them, or inside one, belongs to this project, and so does a session in this planning folder. Coord keeps no repositories: references name theirs in full (`owner/repo#12`, `owner/repo@4ab195a`).

## Work

- `active/` holds work expected to continue.
- `archive/` holds completed, superseded and abandoned work.

The Coord tools create, start, close and archive work items, allocate their numbers and keep the registry current. Find current work through the registry, not by folder numbers or file dates.
