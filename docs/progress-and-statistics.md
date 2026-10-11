# Progress and statistics

Atlas shows how far each piece of work has come and what it took, from two records the agent keeps while it implements a plan: the **steps** in the work's ledger, and short **reports** of its model and tokens. Both live in the planning folder, next to the work, so they are versioned with it and move with it.

## Ledger steps

When implementation starts, the agent (with the `atlas-implement` skill) breaks the accepted plan into steps, one per meaningful deliverable, and lists them in the header of the work's `ledger.md`:

```yaml
---
schema_version: 2
kind: ledger
work_id: work-0001
updated: "2026-10-11"
blocked: null
steps:
  - title: "Implement the agreed query behavior"
    status: done
  - title: "Verify tenant boundaries"
    status: doing
  - title: "Complete review and handoff"
    status: todo
---
```

Each step is `todo`, `doing` or `done`; the agent updates them when a step starts or finishes, when it is blocked, and at handoff. The ledger's body stays free-form: what happened, evidence, PR links, decisions.

In the app:

- the **work list** shows, for each work item, the step being worked on and a small progress bar with done and total steps;
- a work item's **About** sidebar shows the bar, the steps done and left, each step with its status, and any blocker;
- [plan exports](plan-export.md) show the same.

**The work left is the steps not yet done.** It is an estimate by count, not by time: steps differ in size, and Atlas does not predict dates. `atlas planning check` validates the header. Older ledgers with a version-1 header (`current`, `next`) stay readable and show their focus without progress; the agent rewrites the header as version 2 when the work resumes. The exact format is in the planning contract, [`PLANS.md`](../skills/atlas-bootstrap/assets/planning/PLANS.md#ledger-status-version-2).

## Work statistics

At the same moments it updates the ledger, and once when it starts, the agent reports what it knows:

```sh
atlas work report <planning-root> --work work-0001 --model <model-id> --tokens 182000 --session <conversation-id> --step "Verify tenant boundaries"
```

`--tokens` is the tokens used so far in the agent's session, given only when its harness shows them; `--session` keeps reports of agents working at the same time apart. Each report is one line in `<work>/.atlas/statistics.jsonl`. The command never fails the agent's task: a report that cannot be written says so on stderr.

From the reports and the planning folder's Git history, Atlas works out, per work item:

| Statistic          | How it is counted                                                                                                                                            |
| ------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **Model**          | The model with the most active time on the work.                                                                                                             |
| **Tokens**         | Per session, the growth from its first report to its last; a session's first report is its starting point, so tokens spent before this work are not counted. |
| **Active time**    | The time between consecutive reports of a session. A gap of more than two hours is a break, not work.                                                        |
| **Plan revisions** | Commits that changed the main plan after it was added, up to its completion date. Renames are followed, so moving the plan to the archive is not a revision. |
| **Steps**          | Done and total steps from the ledger.                                                                                                                        |

The **Statistics** view shows them in two tabs. **Work** lists every work item with these figures, with totals and the median plan revisions of completed work. **Models over time** compares completed work by implementing model: a chart plots tokens, active time, plan revisions or steps for each completed work item at its completion date, and a table gives each model's medians, so you can see how a new model compares with the ones before it. A work item's About sidebar shows its own statistics.

### What the numbers mean

- **Self-reported and approximate.** Tokens and time come from the agent's own reports, at the moments it reports. An agent that does not report leaves gaps, and a figure nobody reported shows as —.
- **No backfill.** Plan revisions come from Git, so they cover older work too; tokens and time exist only from the first report on.
- **Revisions need history.** Plan revisions count only committed changes, and need the planning folder's Git history.
- **Not a productivity score.** The figures describe how work went. They do not measure the quality of the outcome.

Plan exports leave the statistics file out. `atlas planning check` warns about lines that are not valid reports, and never fails on them. The record format is in [`PLANS.md`](../skills/atlas-bootstrap/assets/planning/PLANS.md#work-statistics).

## Document use

The Statistics view's third tab, **Document use**, is a separate record: which planning documents were opened in Atlas, and which ones agents reported consulting with `atlas usage log`. It is kept outside the planning folder, in the per-user Atlas data folder, and stays on the computer. The [app guide](../app/README.md#document-use) describes it.
