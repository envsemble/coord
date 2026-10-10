# Repository history maps

Atlas keeps its own commit IDs and ancestry. The planning app (`app/`) and the skills (`skills/`) arrived with their full history from two earlier repositories, rewritten so `git log --follow` reaches their first commits. Rewriting changed their commit IDs, so these maps translate an ID quoted in an old plan, ledger, PR or issue to the commit in this repository. Authors, dates and messages are unchanged.

| Map                                                        | Translates                                                                                                                                                                   |
| ---------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [skills-commit-map.txt](skills-commit-map.txt)             | `jakubg05/skills` (up to `480a2cd8026a64e4c82f251aaef83e742586ca69`) to `envsemble/worktrail`. Filtering kept the planning skills, PR babysitting and the dashboard.         |
| [atlas-import-commit-map.txt](atlas-import-commit-map.txt) | `envsemble/worktrail` to this repository. The `ab572c0` entry is the local merge of `ux/dashboard-redesign` (`62d6af3`) into `main` (`12ef4f3`) made just before the import. |

A `jakubg05/skills` ID needs both maps: first to its `envsemble/worktrail` ID, then to the Atlas ID.

During the import, Worktrail's `dashboard/` became `app/` and `skills/` stayed `skills/`. Its root documents, `docs/` and brand assets were imported under `docs/worktrail/` and `assets/worktrail/` and later removed once their content was folded into the current documentation; they remain readable in Git history.
