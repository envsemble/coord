# Jacob's Codex Skills

Personal, reusable skills for [Codex](https://openai.com/codex/). This repository contains the small set of skills I actively maintain, plus two older skills kept safely in the archive.

## Active skills

These three folders are the live collection:

| Skill | What it helps with |
| --- | --- |
| [`babysit-pr`](./babysit-pr) | Guide existing GitHub pull requests through review, fixes, CI, and conflicts. |
| [`implement-plan`](./implement-plan) | Carry out an explicitly selected implementation plan through PR readiness. |
| [`issue-writing`](./issue-writing) | Write concise, specific, actionable issue titles and bodies. |

## Archive

These skills are no longer part of the active collection, but are retained for reference or possible future reuse:

| Skill | Why it is here |
| --- | --- |
| [`repo-commit-splitter`](./archive/repo-commit-splitter) | Retired repository commit-splitting workflow. |
| [`refactor-codebase`](./archive/refactor-codebase) | Retired behavior-preserving refactoring workflow. |

Archived skills are deliberately nested under `archive/`, so Codex will not discover them as active top-level skills. To restore one, move its folder back to the repository root and copy it into your configured skills directory.

## Install

Codex discovers skills as folders directly inside its configured skills directory. Copy only the active folders:

```bash
cp -R babysit-pr implement-plan issue-writing ~/.codex/skills/
```

On Windows PowerShell:

```powershell
Copy-Item .\babysit-pr, .\implement-plan, .\issue-writing "$env:USERPROFILE\.codex\skills\" -Recurse
```

Refresh or restart Codex after installing a skill if it does not appear immediately.

## Skill layout

The repository mirrors Codex's discovery convention while keeping archived material separate:

```text
skills/
├── babysit-pr/
├── implement-plan/
├── issue-writing/
└── archive/
    ├── repo-commit-splitter/
    └── refactor-codebase/
```

Each skill is self-contained. `SKILL.md` is the authoritative contract, and optional `agents/`, `references/`, `scripts/`, and `tests/` folders live beside it when needed.

## Contributing

When adding or updating an active skill, keep it in a kebab-case top-level folder with a complete `SKILL.md`. Keep retired skills under `archive/` and update this README so the active/archived boundary stays obvious.
