<picture>
  <source media="(prefers-color-scheme: dark)" srcset="assets/atlas-banner-dark.svg">
  <source media="(prefers-color-scheme: light)" srcset="assets/atlas-banner-light.svg">
  <img alt="Atlas — Models for shared understanding" src="assets/atlas-banner-light.svg" width="560">
</picture>

[![CI](https://github.com/envsemble/atlas/actions/workflows/ci.yml/badge.svg)](https://github.com/envsemble/atlas/actions/workflows/ci.yml)
[![Version 0.6.0](https://img.shields.io/badge/version-0.6.0-blue)](CHANGELOG.md)
[![Node 24](https://img.shields.io/badge/Node-24-43853d)](docs/releases.md)
[![Private source](https://img.shields.io/badge/license-UNLICENSED-lightgrey)](THIRD_PARTY_NOTICES.md)

Atlas keeps plans, decisions and models in a place both a coding agent and its human can read. Plans, ledgers, glossaries, ADRs and evidence live in a versioned `planning` folder. Next to each plan, the agent keeps diagrams: dated captures of code and databases, and the class diagrams and proposals built on them. The human reads all of it in the Atlas desktop app. The agent edits through the `atlas` command, its MCP server and the Atlas skills.

[Get started](#get-started) · [App guide](app/README.md) · [Skills](skills/README.md) · [The atlas command](docs/command.md) · [Progress and statistics](docs/progress-and-statistics.md) · [Remote access](docs/remote-access.md) · [All documentation](docs/README.md)

![The Atlas desktop app showing an agent's proposed change to captured code in its work item's Diagrams view](app/assets/atlas-desktop.jpg)

| Part                                 | What it does                                                                                                                                           |
| ------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| [App](app/README.md)                 | The desktop app for Windows and Linux: one window per planning folder with its work, plans, ledgers, knowledge, Git activity, statistics and diagrams. |
| [`atlas` command](docs/command.md)   | Model tools, the MCP server, planning checks, plan export and import, and work and consultation reports, for agents and scripts.                       |
| [Skills](skills/README.md)           | Seven `atlas-*` agent skills for setting up, grilling, implementing, recording and organizing plans, and for modeling.                                 |
| [Diagram package](packages/diagrams) | Reads and checks diagrams, captures code and databases, lays out and renders diagrams, and exports offline HTML. Used by the app and the command.      |
| [Planning reader](packages/planning) | The planning-folder reader shared by the app, the host and the command, including [plan export and import](docs/plan-export.md).                       |
| [Host](packages/host)                | Serves planning folders to the desktop app and, with [remote access](docs/remote-access.md) on, to the devices you pair.                               |

## Get started

Use **Node 24**, npm and Git. Java capture also needs a **JDK 21** or newer, and PostgreSQL capture needs a supported PostgreSQL 17 schema.

Installing from a clone needs a GitHub token for Envsemble's private envUI package; [CONTRIBUTING](CONTRIBUTING.md#set-up-and-run) shows how.

1. **Install the app** from its installer (Windows) or AppImage (Linux), built by CI or by `npm run package`; the [app guide](app/README.md#install) explains both, and what to do when Linux has no [sandbox support](app/README.md#linux-sandbox). Or run it from a clone of this repository:

   ```sh
   npm ci
   npm run dev -- /path/to/planning
   ```

2. **Install the `atlas` command** so your agent can use it. From a clone of this repository:

   ```sh
   npm ci
   npm link --workspace @envsemble/atlas-cli
   atlas --version
   ```

   The [command reference](docs/command.md) covers every command, MCP set-up on Windows and the per-user Atlas data folder.

3. **Install the [skills](skills/README.md)** in your agent (Codex or Claude Code). If you have no planning folder yet, ask the agent to use `atlas-bootstrap`; it creates one with governance and a registry of your repositories.
4. **Open the planning folder** with **File › Open Folder…**. Each folder gets its own window, and Atlas follows changes as the agent writes them.

Plans, models and statistics stay on your computer unless you turn on remote access. No model service or API key is needed.

## How work moves through Atlas

1. **Plan.** With `atlas-grill`, the agent interviews you about a change and records the plan, its glossary and its decisions as they settle. You accept the plan.
2. **Implement.** With `atlas-implement`, the agent breaks the accepted plan into steps in the work's ledger and marks each one `todo`, `doing` or `done` as it goes. It reports its model and tokens at each step, and delivers through pull requests with review and CI.
3. **Follow along.** Atlas shows every work item's progress and the steps left, its plan, ledger and decisions, recent commits, and the diagrams that explain it, updating as files change.
4. **Learn from it.** With `atlas-record`, the agent keeps the decisions and lessons worth reusing. The Statistics view compares agent time, tokens and plan revisions by model over time, so you can see how a new model does on your work.

[Progress and statistics](docs/progress-and-statistics.md) explains the ledger's steps, what agents report and how Atlas counts it.

## Share and connect

- **Share a plan.** `atlas plan export <work-id>` (or **File › Export Plan…**) writes the whole work item to one `.atlas-plan.html` file: plan, ledger, glossary, decisions, evidence, attachments and diagrams with their history. Anyone can open it in a browser to read the plan offline; it makes no network requests and runs none of its contents. `atlas plan import <file>` adds it to another planning folder as new work. See [plan export](docs/plan-export.md).
- **Work on another computer.** **File › Remote Access…** lets your other devices work on this computer's planning folders as if they were local: turn it on, choose the Tailscale address and create a pairing link.
  - On the other device, **File › Connect to Another Atlas…** takes the link (it works once, for five minutes).
  - The computer menu in the title bar then switches between computers, and **File › Open Recent** and **Open Folder…** open any planning folder there.
  - `atlas serve` does the same without the app.

  See [remote access](docs/remote-access.md).

## Skills

The [Atlas skills](skills/README.md) work in Codex and Claude Code and name no model or provider. Install them next to the `atlas` command:

| Skill                                       | Purpose                                                                      |
| ------------------------------------------- | ---------------------------------------------------------------------------- |
| [atlas-bootstrap](skills/atlas-bootstrap)   | Create or adopt a planning repository with governance and explicit scope.    |
| [atlas-organize](skills/atlas-organize)     | Organize retained plans and evidence without losing originals.               |
| [atlas-grill](skills/atlas-grill)           | Clarify a design and record shared understanding as it settles.              |
| [atlas-implement](skills/atlas-implement)   | Implement an explicitly selected plan through review and CI.                 |
| [atlas-record](skills/atlas-record)         | Retain useful outcomes, decisions and scoped knowledge.                      |
| [atlas-babysit-pr](skills/atlas-babysit-pr) | Carry existing PRs through the repository's review gate and current-head CI. |
| [atlas-model](skills/atlas-model)           | Capture, author, revise, validate and reopen models while planning.          |

`atlas-implement` and `atlas-babysit-pr` run only when invoked by name.

## Diagrams

A diagram is a `.puml` file in a work item, in Atlas's subset of PlantUML: a class diagram of concepts or code, an entity diagram of a database, or an object diagram of example instances. The agent writes and edits diagrams like any file, and links each from the plan under the heading it explains; the hooks check them after every edit. `atlas capture` writes captures of TypeScript and Java code (through the compiler) and of SQLite, PostgreSQL and local D1 databases, frozen and dated. A proposal starts as a copy of a capture and shows an intended change, and a capture taken after implementing a plan compares with the one taken before. Atlas lays out and draws every diagram itself, in the app, in plan exports and in offline HTML. See [diagrams](docs/diagrams.md).

![An agent proposal in its change view: new and changed classes and relations marked on the canvas, unchanged ones faded, and the Changes list beside it with each changed type's members summarized](assets/comparison-dark.jpg)

## Develop

[Contributing](CONTRIBUTING.md) covers the layout of this repository, the development servers and the checks CI runs. CI runs them on Linux and Windows, including the packaged app's end-to-end tests, and builds versioned [release ZIPs](docs/releases.md). No release is published or deployed.

[Changelog](CHANGELOG.md) · [Release instructions](docs/releases.md) · [Repository history maps](docs/history/README.md) · [Third-party notices](THIRD_PARTY_NOTICES.md)

Source is currently private / `UNLICENSED`. This is a source-use status, not an open-source license. Editable branding lives in `assets/` (the app and viewer icon in `packages/diagrams/assets/`); dependency licenses and attributed example excerpts remain preserved.
