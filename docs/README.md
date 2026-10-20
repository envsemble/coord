# Atlas documentation

## Using Atlas

- [App guide](../app/README.md): install the desktop app; the hub, plans, projects, statistics, diagrams and windows; security and diagnostics.
- [Progress and statistics](progress-and-statistics.md): the ledger's steps, what the hooks measure, how Atlas counts agent time, tokens, subagents and plan revisions for planning and implementation, and a plan's sessions and timeline.
- [Remote access](remote-access.md): work on another computer's projects; pairing, the computer menu, `atlas serve`, the host's protocol, security and privacy.
- [Plan export](plan-export.md): share a whole work item as one offline HTML file, and import it elsewhere.

## For agents

- [Agent interface](agent-interface.md): the Atlas plugin for Claude Code and Codex, its MCP tools, skills and hooks, the Atlas home, and how a session finds its project.
- [The atlas command](command.md): every command and its exit codes, `atlas setup`, and what the Atlas home holds.
- [The atlas skill](../plugin/skills/atlas/SKILL.md), [atlas-grill](../plugin/skills/atlas-grill/SKILL.md) and [atlas-implement](../plugin/skills/atlas-implement/SKILL.md): planning, the questioning in rounds, and implementing with Atlas.
- [Planning contract](../packages/atlas/templates/planning/PLANS.md): the registry, plan and ledger headers, a work item's lifecycle, work statistics and diagrams.

## Diagrams

- [Diagrams](diagrams.md): Atlas's PlantUML subset, `' atlas` comments, captures with `atlas capture`, proposals, before-and-after comparisons, scenarios, and linking a diagram from a plan.
- [Code capture](code-capture.md) and [database capture](database-capture.md): the capture adapters and their limits.
- [Viewer](viewer.md) and [embedding](embedding.md): the viewer's behavior, and using the diagram package and its React panel elsewhere.
- [Architecture](architecture.md): the parts of the diagram package and the atlas package, and the Atlas host.

## Developing Atlas

- [Contributing](../CONTRIBUTING.md): set-up, layout, conventions and the checks CI runs.
- [Releases](releases.md): local packages, versioned release ZIPs and GitHub Releases.
- [Repository history maps](history/README.md): earlier commit IDs from the merged repositories.
- [Changelog](../CHANGELOG.md) and [third-party notices](../THIRD_PARTY_NOTICES.md).
