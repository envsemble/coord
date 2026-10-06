# Jacob's Codex Skills

Reusable skills for [Codex](https://openai.com/codex/). The planning workflow is grouped in one source folder; its skills install as individual sibling folders.

## Planning workflow

| Skill | Purpose |
|---|---|
| [planning-bootstrap](planning-workflow/planning-bootstrap) | Guided creation or adoption of a locally versioned planning repo. |
| [planning-organize](planning-workflow/planning-organize) | Organize work and recover valuable records from surrounding workspace clutter. |
| [planning-grill](planning-workflow/planning-grill) | Clarify work and record plans, vocabulary, and decisions during discussion. |
| [planning-implement](planning-workflow/planning-implement) | Explicitly execute a selected plan persistently through PR readiness. |
| [planning-record](planning-workflow/planning-record) | Retain scoped knowledge, reconcile outcomes, and archive verified closure. |
| [babysit-pr](planning-workflow/babysit-pr) | Independently guide existing PRs through review, CI, fixes, and conflicts. |

Install the group together: bootstrap owns the shared governance/metadata assets; organization supports adoption; grill includes Pocock's preserved methods and formats with [attribution](planning-workflow/planning-grill/references/ATTRIBUTION.md) and [MIT license](planning-workflow/planning-grill/references/LICENSE). Skills read the associated repo's own governance explicitly.

`planning-implement` and `babysit-pr` are explicit-only. Ordinary coding requires neither skill. Grilling and recording can be selected proportionately for useful planning or durable memory. Babysitting does not require planning and uses the PR itself as its record.

## Install

Copy individual skill folders, keeping sibling dependencies together. Do not install the wrapper directory itself as a skill.

```bash
cp -R planning-workflow/planning-* planning-workflow/babysit-pr ~/.codex/skills/
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
