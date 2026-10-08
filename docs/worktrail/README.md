# Jacob's Codex Skills

[![Planning checks](https://github.com/jakubg05/skills/actions/workflows/validate.yml/badge.svg?branch=codex%2Fatlas-planning-integration)](https://github.com/jakubg05/skills/actions/workflows/validate.yml)
[![Dashboard checks](https://github.com/jakubg05/skills/actions/workflows/planning-dashboard.yml/badge.svg?branch=codex%2Fatlas-planning-integration)](https://github.com/jakubg05/skills/actions/workflows/planning-dashboard.yml)
[![Node 24](https://img.shields.io/badge/dashboard-Node_24-43853d)](planning-dashboard/README.md)

Reusable skills for [Codex](https://openai.com/codex/). The planning workflow is grouped in one source folder; its skills install as individual sibling folders.

## Planning workflow

| Skill | Purpose |
|---|---|
| [planning-bootstrap](planning-workflow/planning-bootstrap) | Guided creation or adoption of a locally versioned planning repo. |
| [planning-organize](planning-workflow/planning-organize) | Organize work and recover valuable records from surrounding workspace clutter. |
| [planning-grill](planning-workflow/planning-grill) | Clarify work and record plans, vocabulary, and decisions during discussion. |
| [planning-implement](planning-workflow/planning-implement) | Explicitly execute a selected plan persistently through PR readiness. |
| [planning-record](planning-workflow/planning-record) | Retain scoped knowledge, reconcile outcomes, and archive verified closure. |
| [atlas-modeling](planning-workflow/atlas-modeling) | Inspect and revise models with Atlas while planning; reopen portable diagrams and retain source baseline provenance. |
| [babysit-pr](planning-workflow/babysit-pr) | Independently guide existing PRs through review, CI, fixes, and conflicts. |

Install the group together: bootstrap owns the shared governance/metadata assets; organization supports adoption; grill includes Pocock's preserved methods and formats with [attribution](planning-workflow/planning-grill/references/ATTRIBUTION.md) and [MIT license](planning-workflow/planning-grill/references/LICENSE). Skills read the associated repo's own governance explicitly.

`planning-implement` and `babysit-pr` are explicit-only. Ordinary coding requires neither skill. Grilling and recording can be selected proportionately for useful planning or durable memory. Babysitting does not require planning and uses the PR itself as its record.

## Install

Copy individual skill folders, keeping sibling dependencies together. Do not install the wrapper directory itself as a skill.

```bash
cp -R planning-workflow/planning-* planning-workflow/babysit-pr planning-workflow/atlas-modeling ~/.codex/skills/
cp -R issue-writing ~/.codex/skills/
```

Windows PowerShell:

```powershell
$workflowSkills = Get-ChildItem -Directory .\planning-workflow |
    Where-Object { Test-Path -LiteralPath (Join-Path $_.FullName 'SKILL.md') }
$workflowSkills | ForEach-Object {
    Copy-Item -LiteralPath $_.FullName -Destination "$env:USERPROFILE\.codex\skills" -Recurse -Force
}
Copy-Item -LiteralPath .\issue-writing -Destination "$env:USERPROFILE\.codex\skills" -Recurse -Force
```

When replacing an installed `implement-plan`, retire that old installed entry separately after checking local customizations. The source now has one implementation entry point, `planning-implement`. The new grill does not depend on the separately installed Pocock skills; retire those only after checking their users. Installation does not initialize a planning remote or publish anything.

Use `planning-bootstrap` to create/adopt a folder named `planning` in the relevant workspace. It guides setup with existing content, recoverable local Git history, and optional remote hosting. Product repositories need no mandatory locator file.

## Planning dashboard

The [planning dashboard](planning-dashboard) is a local React viewer for plans, implementation records, knowledge, Git history, and usage statistics. From that directory, run npm ci once, then npm run dev. It reads the sibling planning repository by default, with --planning-dir for another location. Node.js 24+ is required; nothing needs a model API or remote hosting.

The five planning skills report actual document consultation through the shared bootstrap helper, even while the dashboard is closed. Browser views are collected separately. Usage stays in a local cache outside planning documents. See the [dashboard guide](planning-dashboard/README.md) for launch options and collection limitations.

### Plan with Atlas

Use [atlas-modeling](planning-workflow/atlas-modeling) to inspect a dated database/class snapshot, author a conceptual proposal, compare changes and retain selected plan/glossary/code references. Atlas is the modeling tool; the planning records still own decisions and progress. The dashboard embeds its React viewer directly. Portable HTML is a separate offline submission/review mode that an agent can reopen later.

![Atlas comparison inside the planning dashboard, with plan and ledger navigation](planning-dashboard/assets/atlas-dashboard.jpg)

The [Atlas repository](https://gitlab.fit.cvut.cz/gordijak/kom-apex-legends) owns capture, validation, diagrams and export. This repository owns the planning skill and dashboard integration, with a reproducible commit/hash-pinned consumer package. [Integration and distribution](planning-dashboard/README.md#atlas-diagrams) describe the boundary and nonpublishing CI artifacts.

## Other skills and archive

[issue-writing](issue-writing) remains independent. Archived [repo-commit-splitter](archive/repo-commit-splitter) and [refactor-codebase](archive/refactor-codebase) remain available for reference and are not part of the installed collection.

## Validation

Use Python 3 and install the development-only dependency from `requirements-dev.txt`:

```bash
python -m unittest discover -s planning-workflow/tests -v
python -m unittest discover -s planning-workflow/planning-bootstrap/scripts/tests -v
python planning-workflow/planning-bootstrap/scripts/check_planning.py /path/to/planning
```

The planning checker is read-only and uses only the standard library. It checks registry scope, pointers, metadata, and containment; it does not determine historical truth or prove usefulness. Behavioral evaluation requires representative tasks and preservation evidence.

Keep essential instructions in `SKILL.md`, with references/assets/scripts only where useful. Update this README when changing source grouping or public entry points.
