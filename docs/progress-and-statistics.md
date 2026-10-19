# Progress and statistics

Atlas shows how far each piece of work has come and what it took, from two records: the **steps** in the work's ledger in the planning folder, which the agent keeps current through the Atlas tools and which are versioned with the work, and **reports** that Atlas's hooks measure from the agent's own session log, kept in the [home database](command.md#the-atlas-home) under the work item's project.

## Ledger steps

A work item has its ledger from the moment it is created, with the **planning steps**: "Understand the request" (doing), "Settle the design", "Write the plan" and "Accepted". The agent keeps them true while designing, renaming, adding or removing them to fit the work (steps added before implementation starts are planning steps), and accepting the design (`work_accept`) marks them done. When implementation starts, the agent (with the `atlas-implement` skill) breaks the accepted plan into steps, one per meaningful deliverable, and starts the work with them (the `work_start` tool, or `atlas work start`). Atlas adds them after the planning steps in the header of the work's `ledger.md`:

```yaml
---
schema_version: 2
kind: ledger
work_id: work-0001
updated: "2026-10-11"
blocked: null
steps:
  - title: "Understand the request"
    status: done
    phase: planning
  - title: "Settle the design"
    status: done
    phase: planning
  - title: "Implement the agreed query behavior"
    status: done
  - title: "Verify tenant boundaries"
    status: doing
  - title: "Complete review and handoff"
    status: todo
---
```

Each step is `todo`, `doing` or `done`; a planning step has `phase: planning`, and a step without a phase is an implementation step, as every step of older ledgers is. Progress counts all of them. The agent changes them through the step tools (`step_set`, `step_add`, `step_rename`, `step_remove`) when a step starts or finishes and at handoff, and sets `blocked` with `work_block`; `work_close` refuses while any step is open or the work is blocked. The ledger's body stays free-form: what happened, evidence, PR links, decisions.

In the app:

- the **hub** shows, for each plan, a small progress bar with done and total steps, the planning steps in their own colour;
- a work item's **About** sidebar shows the bar, the steps done and left, each step with its status, and any blocker;
- [plan exports](plan-export.md) show the same.

**The work left is the steps not yet done.** It is an estimate by count, not by time: steps differ in size, and Atlas does not predict dates. `atlas check` validates the header. Older ledgers with a version-1 header (`current`, `next`) stay readable and show their focus without progress; the agent rewrites the header as version 2 when the work resumes. The exact format is in the planning contract, [`PLANS.md`](../plugin/skills/atlas/assets/planning/PLANS.md#ledger-status-version-2).

## Work statistics

Agents do not report statistics: the Atlas plugin's [hooks](agent-interface.md#hooks) measure them. When an agent edits a work item's files in the planning folder, or changes the work through an Atlas tool, the hook links its session to that work item. Whenever the session stops, or one of its subagents does, Atlas reads the session's log on this computer and appends one report per linked work item, covering what the session did since its previous report on that item, or, for its first, since the hook linked it:

- **Agent time**: the time the agent worked, from each prompt to the last activity of that turn (its output, tool calls and their results), without the time it waited for a person: between turns, for the answer to a question, or, in Claude Code, in a permission prompt (Codex's log does not show a wait for approval, so there it counts). Every agent counts in full: the main agent's own time and each helper's (subagent's) add up, also while they work at the same time. The report also keeps when each agent worked (its working intervals), so Atlas can tell the time at least one of them was working. A turn still under way when the report is made, such as a helper waiting for its tests, counts until the report if its log was written in the last quarter of an hour.
- **Tokens** for each model, by kind: new input, input read from the prompt cache, input written to it, and output.
- **The model** of each response, and its **reasoning effort** (`high`, `medium`…) where the log names it: Claude Code on each response, Codex in each turn's context. The report names the main agent's model, and keeps each agent's time and tokens by model and effort.
- **Subagents**: how many worked in the interval, each one's own working time added up, their tokens, and the busiest few with their models.
- **The stage**: `planning` while the work's plan is a draft, `implementation` once it is accepted. A session that edits an accepted plan is amending the design, so what it did until its next report counts as planning.

The log is only read, never copied: a report holds these numbers and model identifiers, never prompts, paths or tool output. Claude Code's log is `<config>/projects/<project>/<session>.jsonl` with its subagents' logs beside it (`<config>` is `CLAUDE_CONFIG_DIR`, else `~/.claude`); Codex's are the thread's rollouts under `<home>/sessions/` or `<home>/archived_sessions/`, with its subagents' threads (`<home>` is `CODEX_HOME`, else `~/.codex`). A Codex subagent's thread belongs to its root session: its own reports count as that session's, so its work is never counted twice.

Each report is a row of the home database, with its models, subagents and working intervals beside it, keyed by the planning folder's project and the work item; nothing is written into the planning folder. A hook never fails the agent's session: a report it cannot write or measure is noted in the home's `logs/hooks.log`.

### Reporting without the hooks

An agent whose harness runs without the plugin's hooks reports by hand, when it starts and at each change of step:

```sh
atlas work report <planning-root> --work work-0001 --step "Verify tenant boundaries"
```

Inside Claude Code or Codex, the command finds the session the harness names in the environment (`CLAUDE_CODE_SESSION_ID`, `CODEX_THREAD_ID`) and measures it from its log just as the hooks do. Elsewhere, the agent gives what it knows: `--model <model-id>`, and `--session <conversation-id>` and `--tokens <n>` (the tokens used so far in its session) when its harness shows them. Without a session, the same model's reports less than two hours apart count as one session, so agents working at the same time should always give one. When a session's log cannot be read, the command says why on stderr and records the report without a measurement. The command never fails the agent's task.

From the reports and the planning folder's Git history, Atlas works out, per work item:

| Statistic          | How it is counted                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| ------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Model**          | The model that did most of the work: the most agent time, then the most tokens. The other models, such as a helper's or one that took over, are listed with it.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| **Stage**          | Each report counts toward the stage it records: planning or implementation. Reports from before stages were recorded are shown apart, as "Stage not recorded".                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| **Agent time**     | Every agent's time added up. Measured, for the reports that carry a measurement: each agent's working time since the session's previous report. Otherwise estimated: the time between consecutive reports of a session, where a gap of more than two hours is a break. A hooked session's first report on a work item measures from when the session was linked to it; a first report made by hand is a starting point, so work the session did before is not counted. On hover, the time at least one agent was working: the union of the reports' working intervals, across sessions and subagents, with the time of reports without intervals added as is. |
| **Tokens**         | Measured, for the reports that carry a measurement: each model's tokens by kind. Otherwise self-reported: per session, the growth from one report to the next, from its first report on; a count lower than the one before means a new conversation, and is counted in full.                                                                                                                                                                                                                                                                                                                                                                                  |
| **Subagents**      | How many subagents worked on the work item, each counted once, and their own working time added up.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| **Plan revisions** | Commits that changed the main plan after it was added, up to its completion date. Renames are followed, so moving the plan to the archive is not a revision.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| **Steps**          | Done and total steps from the ledger.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |

The **Statistics** page (in the menu) shows them, one project at a time. **Work** lists every work item with these figures, its agent time and tokens in a column per stage, with totals and the median plan revisions of completed work. **Models over time** compares completed work by implementing model: a chart plots agent time, tokens, plan revisions or steps for each completed work item at its completion date, and a table gives each model's medians, so you can see how a new model compares with the ones before it. A work item's About sidebar sums up its own statistics: the model with its provider's mark, the agent time and tokens of each stage (on hover or focus, how much was measured and since when, and the tokens by kind), the subagents and the plan revisions.

### What the numbers mean

- **Measured where the log can be read.** With the hooks, and for reports made inside Claude Code and Codex, agent time and tokens come from the session's own log. Older reports, and reports from agents whose log Atlas cannot read, are estimates from report times with self-reported tokens; the app says how much of the agent time was measured.
- **Every agent adds up.** Five agents working for an hour at once are five hours of agent time and one hour of time at least one worked; the hover shows both, with each agent's share, by model and by stage.
- **Older reports are measured again.** Reports from before 0.8.0 kept only a total, in which helpers working at once counted once. The app's host measures each of them again from its session's log in the background, once, where the log is still on this computer; where it is gone, the report keeps its total, and the hover says how much of the time comes from such reports.
- **A session's work, on one work item at a time.** A session counts for the work item it last edited or called an Atlas tool on. Its report measures what it did since its previous report there, or since it came to it; when it moves to another work item, the one it leaves gets its report up to then. So a session on two plans splits its time between them instead of counting it on both.
- **Cached input dominates tokens.** An agent re-reads its context from the prompt cache with every response, so most of its tokens are cache reads; the breakdown shows them apart.
- **Compactions' tokens are missing.** Claude Code does not log what a compaction (summarising a long conversation) used, only how long it took: its time counts, its tokens, about the size of the conversation each time, do not.
- **No backfill.** Plan revisions come from Git, so they cover older work too; agent time and tokens exist only from the first report on, and stages and subagents only from reports that record them.
- **Revisions need history.** Plan revisions count only committed changes, and need the planning folder's Git history.
- **Not a productivity score.** The figures describe how work went. They do not measure the quality of the outcome.

Before the home database, reports were lines of `<work>/.atlas/statistics.jsonl` in the planning folder. `atlas setup` (for the planning folders in the home; it leaves folders outside the home alone) and `atlas home adopt` (as it moves a folder in) import such files into the database, each report once, and delete them from the planning folder; Atlas never commits, so commit the removal there (Git keeps the files' history). Plan exports leave them out.

### Sessions and the timeline

A plan's sessions come from the home database: each session linked to it, with the model and reasoning effort it used most there, whether it works, waits for you or has ended, its agent time on the plan, the folder it runs in, and, while it waits, its turn's last message. The commits and PRs the sessions made are listed with them, as the hooks saw them. The plan's timeline says how long it was planned (created to accepted), implemented (accepted to completed, or now) and waited for you (the sessions' waits on it, each at most a day), with a lane per session and subagent: its working stretches from the reports' intervals and its waits.

### What agents do now

The hooks also record what each linked session does: working while its agent is in a turn, waiting for you once the turn ends or while it asks for permission (see [hooks](agent-interface.md#hooks)). A plan is **Working** while a session on it works and **Needs you** while one waits; a session on several plans counts for the one it is on, and Needs you ends early when another session works on the plan. While a plan is Working, its agent time counts up live: each working session adds the time since its turn started, since its last report on the plan or since it came to it, whichever is later, leaving out its waits for a permission; a session that waits keeps its time not yet reported until its report is in. Each report sets the figure from the log again (adding the helpers' time then), in the same update as the live count it replaces.

## Document use

The Statistics section's third choice, **Document use**, is a separate record: which planning documents were opened in Atlas, and which ones agents reported consulting with `atlas usage log` (or read, with the hooks). It is kept outside the planning folder, in the home database under the project, with the gaps in its collection. With [remote access](remote-access.md) on, paired devices see the counts of the computer whose project they show, and their views count there. The [app guide](../app/README.md#document-use) describes it.
