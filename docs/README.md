# Coord documentation

## Using Coord

- [App guide](../app/README.md): install the desktop app; the hub, plans, projects, statistics, diagrams and windows; security and diagnostics.
- [Progress and statistics](progress-and-statistics.md): the ledger's steps, what the hooks measure, how Coord counts agent time, tokens, subagents and plan revisions for planning and implementation, and a plan's sessions and timeline.
- [Remote access](remote-access.md): work on another computer's projects; pairing, the computer menu, `coord serve`, the host's protocol, security and privacy.

## For agents

- [Agent interface](agent-interface.md): the Coord plugin for Claude Code and Codex, its MCP tools, skills and hooks, the Coord home, and how a session finds its project.
- [The coord command](command.md): every command and its exit codes, `coord setup`, and what the Coord home holds.
- [The coord skill](../plugin/skills/coord/SKILL.md), [coord-grill](../plugin/skills/coord-grill/SKILL.md) and [coord-implement](../plugin/skills/coord-implement/SKILL.md): planning, the questioning in rounds, and implementing with Coord.
- [Planning contract](../packages/coord/templates/planning/PLANS.md): the registry, plan and ledger headers, a work item's lifecycle, work statistics and diagrams.

## Diagrams

- [Diagrams](diagrams.md): Coord's PlantUML subset, `' coord` comments, captures with `coord capture`, proposals, before-and-after comparisons, scenarios, and linking a diagram from a plan.
- [Code capture](code-capture.md) and [database capture](database-capture.md): the capture adapters and their limits.
- [Viewer](viewer.md) and [embedding](embedding.md): the viewer's behavior, and using the diagram package and its React panel elsewhere.
- [Pages](pages.md): the views agents make in a work item's `pages/`, how Coord builds and runs them in place, choices, and what a page may reach.
- [Architecture](architecture.md): the parts of the diagram package and the coord package, and the Coord host.

## Developing Coord

- [Contributing](../CONTRIBUTING.md): set-up, layout, conventions and the checks CI runs.
- [Releases](releases.md): local packages, versioned release ZIPs and GitHub Releases.
- [Repository history maps](history/README.md): earlier commit IDs from the merged repositories.
- [Changelog](../CHANGELOG.md) and [third-party notices](../THIRD_PARTY_NOTICES.md).
