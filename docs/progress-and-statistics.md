# Progress and statistics

Atlas shows how far each piece of work has come and what it took, from two records the agent keeps while it implements a plan: the **steps** in the work's ledger, and short **reports** at each change of step, measured from the agent's own session log where Atlas can read it. Both live in the planning folder, next to the work, so they are versioned with it and move with it.

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

At the same moments it updates the ledger, and once when it starts, the agent reports the step:

```sh
atlas work report <planning-root> --work work-0001 --step "Verify tenant boundaries"
```

Inside **Claude Code** or **Codex**, that is all it takes. The command runs in the agent's harness, which names its session in the environment (`CLAUDE_CODE_SESSION_ID`, `CODEX_THREAD_ID`) and keeps a log of it on this computer. Atlas reads that log and records the session, the model, and what the agent did since the session's previous report on this work item:

- **Agent time**: the time the agent worked, from each prompt to the last activity of that turn (its output, tool calls and their results), without the time it waited for a person: between turns, for the answer to a question, or in a permission prompt. Its helpers (subagents) count too, and work they do at the same time counts once.
- **Tokens** for each model, by kind: new input, input read from the prompt cache, input written to it, and output.
- **The model** of each response. The report names the main agent's model.

The log is only read, never copied: a report holds these numbers and model identifiers, never prompts, paths or tool output. Claude Code's log is `<config>/projects/<project>/<session>.jsonl` with its subagents' logs beside it (`<config>` is `CLAUDE_CONFIG_DIR`, else `~/.claude`); Codex's are the thread's rollouts under `<home>/sessions/`, with its subagents' threads (`<home>` is `CODEX_HOME`, else `~/.codex`).

Elsewhere, the agent gives what it knows: `--model <model-id>`, and `--session <conversation-id>` and `--tokens <n>` (the tokens used so far in its session) when its harness shows them. Without a session, the same model's reports less than two hours apart count as one session, so agents working at the same time should always give one. When a session's log cannot be read, the command says why on stderr and records the report without a measurement. Each report is one line in `<work>/.atlas/statistics.jsonl`. The command never fails the agent's task: a report that cannot be written says so on stderr.

From the reports and the planning folder's Git history, Atlas works out, per work item:

| Statistic          | How it is counted                                                                                                                                                                                                                                                                                                                                      |
| ------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **Model**          | The model that did most of the work: the most agent time, then the most tokens. The other models, such as a helper's or one that took over, are listed with it.                                                                                                                                                                                        |
| **Agent time**     | Measured, for the reports that carry a measurement: the agent's working time since the session's previous report. Otherwise estimated: the time between consecutive reports of a session, where a gap of more than two hours is a break. A session's first report on a work item is its starting point, so work the session did before is not counted. |
| **Tokens**         | Measured, for the reports that carry a measurement: each model's tokens by kind. Otherwise self-reported: per session, the growth from one report to the next, from its first report on; a count lower than the one before means a new conversation, and is counted in full.                                                                           |
| **Plan revisions** | Commits that changed the main plan after it was added, up to its completion date. Renames are followed, so moving the plan to the archive is not a revision.                                                                                                                                                                                           |
| **Steps**          | Done and total steps from the ledger.                                                                                                                                                                                                                                                                                                                  |

The **Statistics** view shows them in two tabs. **Work** lists every work item with these figures, with totals and the median plan revisions of completed work. **Models over time** compares completed work by implementing model: a chart plots agent time, tokens, plan revisions or steps for each completed work item at its completion date, and a table gives each model's medians, so you can see how a new model compares with the ones before it. A work item's About sidebar sums up its own statistics: the model with its provider's mark, the agent time (on hover or focus, how much was measured and since when), the tokens (on hover or focus, by kind) and the plan revisions.

### What the numbers mean

- **Measured where the log can be read.** Inside Claude Code and Codex, agent time and tokens come from the session's own log. Older reports, and reports from agents whose log Atlas cannot read, are estimates from report times with self-reported tokens; the app says how much of the agent time was measured.
- **A session's work, between its reports.** A report measures everything its session did since its previous report on the same work item. A session that works on several work items at once counts its time towards each of them.
- **Cached input dominates tokens.** An agent re-reads its context from the prompt cache with every response, so most of its tokens are cache reads; the breakdown shows them apart.
- **No backfill.** Plan revisions come from Git, so they cover older work too; agent time and tokens exist only from the first report on.
- **Revisions need history.** Plan revisions count only committed changes, and need the planning folder's Git history.
- **Not a productivity score.** The figures describe how work went. They do not measure the quality of the outcome.

Plan exports leave the statistics file out. `atlas planning check` warns about lines that are not valid reports, and never fails on them. The record format is in [`PLANS.md`](../skills/atlas-bootstrap/assets/planning/PLANS.md#work-statistics).

## Document use

The Statistics view's third tab, **Document use**, is a separate record: which planning documents were opened in Atlas, and which ones agents reported consulting with `atlas usage log`. It is kept outside the planning folder, in the per-user Atlas data folder. With [remote access](remote-access.md) on, paired devices see the counts of the computer whose folder they show, and their views count there. The [app guide](../app/README.md#document-use) describes it.
