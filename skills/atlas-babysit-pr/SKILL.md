---
name: atlas-babysit-pr
description: Guide existing GitHub PRs through review, fixes, CI, and conflicts until ready for human review. Use only when explicitly invoked by name (for example $atlas-babysit-pr or /atlas-babysit-pr) or directed by another explicitly invoked skill; no planning repository is required. Formerly worktrail-babysit-pr and babysit-pr.
disable-model-invocation: true
---

# Atlas Babysit PR

Guide one or more existing PRs, across repositories if needed, until the current head passes validation and the repository's review gate covers it with no valid unresolved findings. Relevant issue links and metadata polish happen alongside this loop, preferably during waits.

Ground scope in the user's request, PR context, and repository instructions. Preserve explicit decisions and other contributors' changes. This skill is independently usable without a planning repository. The PR itself is the progress record: use its description, review threads, checks, and reviews. Create no separate ledger, checklist, or progress file. A calling implementation workflow may update relevant milestones in its own existing ledger.

Invocation authorizes in-scope fixes and pushes, PR updates and metadata, issue linking, review requests to the repository's configured reviewers, and replies to findings, subject to the user's current scope and higher-priority permissions. Creating issues or additional PRs requires user agreement. Do not merge, enable auto-merge, deploy, change protections, or send unrelated messages. Historical permissions do not authorize new actions.

## Review gate

Discover each repository's configured reviewers from its documentation and settings (contributing guides, agent instructions, workflow and bot configuration, code owners) and its recent PR history: for example a review bot, an AI reviewer, or designated human reviewers. Learn each automated reviewer's actual trigger and completion signal from that evidence, such as review on push, a comment command, or a reviewer request; do not guess identities or commands. Explicit user instructions about review take precedence.

The readiness gate for each PR is one of:

- **Configured review:** every configured automated reviewer completed a review covering the current head.
- **Independent review:** when no automated reviewer is configured or available, an independent adversarial review of the PR's changes, by you or a delegated reviewer, before each head is pushed. A reviewer is unavailable when it cannot be used here (no access, no subscription, or the user says so), not when it is merely slow.

Both gates also require passing CI on the current head. Findings from human reviewers get the same dispositions, but their approval is not part of readiness and stays with the user. Report which gate applied and why; a calling implementation workflow records it in its ledger.

## Review loop

Initially inspect each PR's description, diff, head, checks, reviews, threads, and mergeability, and establish its review gate. Ask for a URL only if the PR cannot be identified. Report closed or merged PRs without reopening them.

Repeat per PR:

1. Refresh the head, checks, and new review activity. Compare state first; reuse unchanged repository context and inspect only code/logs needed for new evidence. Batch independent fetches where practical.
2. Validate findings from all reviewers against the code and intended behavior. Separate defects from scope changes; ask about genuine product decisions while continuing independent work.
3. Batch related valid findings, CI fixes, and conflict resolutions. Review substantial or risky fixes independently when it adds meaningful coverage; use focused self-review for routine edits. Under the independent gate, review every new commit adversarially before pushing it. Run relevant verification, then commit and push together where practical.
4. Reply in each original thread with the correction, verification, and exact pushed fixing-commit link. Explain inapplicable findings and answer questions with evidence. Resolve threads only when supported by evidence and repository convention.
5. Await applicable CI and the review gate covering the current head. After every new commit, repeat affected validation and request follow-up review through the discovered mechanism. Recheck dependent PRs when affected.

A review request, reaction, queued job, or generic bot comment is not completed review. Confirm completion for the actual reviewed commit and read inline comments and threads. A review of an earlier head does not cover new commits. If completion/current-head coverage cannot be established, report that gate as incomplete. Confirm expected CI actually ran: missing, pending, canceled, or unexpected skips are not success. Accept skips or neutral results only when repository configuration supports them. Never weaken checks or tests. Inspect failure logs; rerun unchanged code only with evidence of a transient failure.

Poll with bounded waits and backoff; work on other PRs or polish while waiting. Share meaningful changes without repetitive status comments. Investigate repeated equivalent failures; after three unsuccessful non-progressing attempts, report the external blocker and required action. Normal running jobs are not failed attempts. Continue pending work while access and execution time allow; otherwise report incomplete status and the next action. Claim later monitoring only if an authorized wakeup was actually scheduled.

## Efficient execution

Use direct tools for polling, fetching targeted comments/logs, and mechanical bookkeeping or metadata changes. Compare head, check, and review state before loading context; do not reread unchanged diffs or delegate waits.

Delegate only when it saves meaningful work and tools/instructions allow it. Batch related tasks, reuse agents where practical, and provide only relevant requirements, diff, finding, or log excerpts. Avoid an agent per comment or a duplicate full PR review. Match review depth to difficulty; model and effort choices follow the user's and harness's configuration. Agents doing bounded support work must not independently dismiss findings or declare readiness. Escalate ambiguity with relevant evidence instead of repeating inadequate retries.

## Issue links and PR polish

Check for a related issue when the PR, task, or repository context points to one, or a likely match is easy to identify. Read plausible matches and link genuine issues without duplicates. Avoid broad searches solely to fill PR metadata. Use closing references only for fully resolved issues; use ordinary links for partial work and qualified references across repositories.

Do not create an issue as part of routine PR babysitting. If one would materially help and the user has not authorized it, present a concise proposal and ask once while continuing independent review work; never treat silence as approval. Recheck duplicates before approved creation, then link it. Use an available `issue-writing` skill for the proposal if useful; it is optional and separate from this suite.

Apply clearly relevant existing labels, projects, milestones, and assignees when supported by repository conventions and task context. Preserve intentional metadata; do not invent release commitments or assume participants are owners. Distinguish assignees from reviewers. Leave ambiguous or optional fields unchanged. Verify any changes made; optional metadata access failures do not block review convergence.

Keep the title and description concise and self-contained: final problem, resulting behavior, relevant choices, and actual validation. Follow repository templates, remove stale claims, and link related PRs with dependencies and merge order when needed.

## Handoff

Freshly inspect current head, checks, reviews, threads, and mergeability before declaring readiness. Reconcile concurrent changes; if the head changes during verification, refresh the affected gates instead of declaring the stale snapshot ready. Ready means:

- Required validation and applicable CI passed for the current head, with no required checks missing.
- The review gate covers that head; all actionable findings/questions have evidenced dispositions, with no valid unresolved finding.
- Fixed findings have commit-linked replies, the description is current, and no merge conflicts remain.

Mark qualifying drafts ready unless requested otherwise. Report each PR's link, readiness, verified head, the review gate applied, check/review evidence, and any blocker or unfinished polish. Missing access, unfinished CI, or configured review not confirmed for the current head is an incomplete gate, not assumed success. Human approval and merge remain with the user.
