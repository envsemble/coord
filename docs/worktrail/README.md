<picture>
  <source media="(prefers-color-scheme: dark)" srcset="assets/worktrail-banner-dark.svg">
  <source media="(prefers-color-scheme: light)" srcset="assets/worktrail-banner-light.svg">
  <img alt="Worktrail — Plans, evidence, shared understanding" src="assets/worktrail-banner-light.svg" width="1200">
</picture>

[![CI](https://github.com/envsemble/worktrail/actions/workflows/ci.yml/badge.svg?branch=codex%2Fworktrail-migration)](https://github.com/envsemble/worktrail/actions/workflows/ci.yml)
[![Node 24](https://img.shields.io/badge/Node-24-43853d)](dashboard/README.md)
[![Python 3](https://img.shields.io/badge/Python-3-blue)](requirements-dev.txt)
[![Private source](https://img.shields.io/badge/license-UNLICENSED-lightgrey)](THIRD_PARTY_NOTICES.md)

Worktrail brings an agent's planning workflow and a local React dashboard together. Keep plans, decisions, implementation evidence and useful knowledge in a versioned `planning` repository. Inspect them alongside [Atlas](https://github.com/envsemble/atlas) models, dated source baselines, proposed changes and teaching reports.

![Worktrail with Atlas diagrams and plan navigation](dashboard/assets/atlas-dashboard.jpg)

## Install the skills

Install the seven `skills/worktrail-*` folders as siblings in your Codex skills directory. The wrapper `skills` folder is not a skill.

```sh
cp -R skills/worktrail-* ~/.codex/skills/
```

PowerShell:

```powershell
Get-ChildItem -Directory ./skills/worktrail-* | ForEach-Object {
  Copy-Item -LiteralPath $_.FullName -Destination "$env:USERPROFILE/.codex/skills" -Recurse -Force
}
```

| Skill | Purpose |
| --- | --- |
| [worktrail-bootstrap](skills/worktrail-bootstrap) | Create or adopt a planning repository with governance and explicit scope. |
| [worktrail-organize](skills/worktrail-organize) | Organize retained plans and evidence without losing originals. |
| [worktrail-grill](skills/worktrail-grill) | Clarify a design and record shared understanding as it settles. |
| [worktrail-implement](skills/worktrail-implement) | Execute an explicitly selected plan through review and CI. |
| [worktrail-record](skills/worktrail-record) | Retain useful outcomes, decisions and scoped knowledge. |
| [worktrail-babysit-pr](skills/worktrail-babysit-pr) | Carry explicitly selected PRs through current-head CI and Codex review. |
| [worktrail-atlas](skills/worktrail-atlas) | Capture, inspect, revise, validate and reopen architecture models with Atlas. |

Implementation and PR babysitting remain explicit-only. Existing authorization, local governance and selected plan identities remain authoritative. See [migration](docs/migration.md) before replacing older installed names; installation does not remove local customizations or publish planning content.

## Open the dashboard

Use Node 24 and Python 3. From the repository root:

```sh
npm --prefix dashboard ci
npm --prefix dashboard run dev
```

Open **http://127.0.0.1:4317/**. By default the dashboard reads a sibling `planning` folder. Connect another folder with `npm --prefix dashboard run dev -- --planning-dir /path/to/planning`. Plans, ledgers, knowledge, Git history and actual consultation statistics stay local. No model service or API key is required.

Atlas renders directly in React; diagrams remain read-only. An agent edits through the Atlas library/CLI/MCP, with stable semantic IDs linking plan passages and pinned code evidence. Offline HTML export/reopen is a separate submission/review mode. The dashboard pins a committed Atlas tarball and SHA-256, so its installation and CI require no sibling Atlas checkout.

## Check and package

```sh
python -m pip install -r requirements-dev.txt
python -m unittest discover -s skills/tests -v
python -m unittest discover -s skills/worktrail-bootstrap/scripts/tests -v
npm --prefix dashboard test
npm --prefix dashboard run build
npm --prefix dashboard run check:release
npm --prefix dashboard run release:assemble
```

GitHub Actions runs skill checks, Ubuntu/macOS dashboard consumers, review/export/reopen, reproducible release checks and the required `CI` / `Betterleaks` gates. Versioned artifacts include source, skills, documentation, branding and the pinned Atlas package. User planning records, local `.atlas` models and usage databases are excluded. Assembly publishes and deploys nothing.

[Dashboard guide](dashboard/README.md) · [Migration and preserved history](docs/migration.md) · [Contributing](CONTRIBUTING.md) · [Changelog](CHANGELOG.md) · [Notices](THIRD_PARTY_NOTICES.md)
