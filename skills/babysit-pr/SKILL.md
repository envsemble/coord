---
name: babysit-pr
description: Guide existing GitHub PRs through review, fixes, CI, and conflicts until ready for human review. Use when explicitly invoked as $babysit-pr or by name, or directed by another explicitly invoked skill.
---

# Babysit PR

Guide one or more existing PRs, across repositories if needed, until the current head passes validation and completed Codex review leaves no valid unresolved findings. Issue linking and metadata polish happen alongside this loop, preferably during waits.

Ground scope in the user's request, PR context, and repository instructions. Preserve explicit decisions and other contributors' changes. The PR itself is the progress record: use its description, review threads, checks, and reviews. Create no separate ledger, checklist, or progress file.

Invocation authorizes in-scope fixes and pushes, PR updates and metadata, issue linking, Codex review requests, and replies to findings, subject to higher-priority permissions. Creating issues or additional PRs requires user agreement. Do not merge, enable auto-merge, deploy, change protections, or send unrelated messages.

## Review loop

Initially inspect each PR's description, diff, head, checks, reviews, threads, and mergeability. Read repository conventions and discover its actual Codex review trigger and completion signal; do not guess bot identities. Ask for a URL only if the PR cannot be identified. Report closed or merged PRs without reopening them.

Repeat per PR:

1. Refresh the head, checks, and new review activity. Reuse unchanged repository context; inspect code and logs where new evidence requires it.
2. Validate findings from all reviewers against the code and intended behavior. Separate defects from scope changes; ask about genuine product decisions while continuing independent work.
3. Batch related valid findings, CI fixes, and conflict resolutions. Review material fixes adversarially, run relevant verification, then commit and push together where practical.
4. Reply in each original thread with the correction, verification, and exact pushed fixing-commit link. Explain inapplicable findings and answer questions with evidence. Resolve threads only when supported by evidence and repository convention.
5. Await applicable CI and completed GitHub Codex review covering the current head. After every new commit, repeat affected validation and request follow-up review through the supported mechanism. Recheck dependent PRs when affected.

A review request, reaction, queued job, or generic bot comment is not completed review. Confirm the reviewed commit and read inline comments and threads. Confirm expected CI actually ran: missing, pending, canceled, or unexpected skips are not success. Accept skips or neutral results only when repository configuration supports them. Never weaken checks or tests. Inspect failure logs; rerun unchanged code only with evidence of a transient failure.

Poll with bounded waits and backoff; work on other PRs or polish while waiting. Share meaningful changes without repetitive status comments. Investigate repeated equivalent failures; after three unsuccessful non-progressing attempts, report the external blocker and required action. Normal running jobs are not failed attempts. Continue pending work while access and execution time allow; otherwise report incomplete status and the next action. Claim later monitoring only if an authorized wakeup was actually scheduled.

## Cost control

Use tools directly for polling, fetching comments and logs, and metadata operations. Compare head, check, and review state before loading more context; do not reread unchanged diffs or spawn agents for waiting.

When delegation is available, use lighter agents for bounded log summaries, issue shortlists, replies grounded in verified fixes, and unambiguous metadata work. Use more capable agents for finding validation, unclear failures, fixes, conflicts, and readiness judgment. Escalate ambiguity with the relevant evidence instead of repeated lighter-agent retries; lighter agents must not independently dismiss findings or declare readiness.

Delegate only when it saves meaningful work. Batch related tasks, reuse agents where practical, and provide only the relevant requirements, diff, finding, or log excerpt. Avoid an agent per comment or duplicating the full PR review. Choose among available models without changing the user's configured model or assuming a specific model name is available.

## Issue links and PR polish

Inspect open issues by problem and component, reading plausible matches and paginating or narrowing searches as needed. Link genuine matches without duplicates. Use closing references only for fully resolved issues; use ordinary links for partial work and qualified references across repositories.

If no matching issue exists, use [issue-writing](../issue-writing/SKILL.md) to propose its repository, title, and brief body. Ask via `request_user_input_async` whether to create it while continuing review work; batch questions when practical. If unavailable, present the proposal in the next user update. Reuse existing authorization, never treat silence as approval, and do not repeat pending or declined requests. Recheck duplicates before approved creation, then link the issue.

Apply relevant existing labels, milestones, and assignees using repository conventions, linked issues, release scope, and supported ownership. Preserve intentional metadata; do not invent release commitments or assume participants are owners. Distinguish assignees from reviewers. Ask asynchronously about ambiguous choices and leave those fields unchanged pending an answer. Verify saved links and metadata; optional decisions or metadata access failures do not block review convergence.

Keep the title and description concise and self-contained: final problem, resulting behavior, relevant choices, and actual validation. Follow the repository template, remove stale claims, and link related PRs with dependencies and merge order where needed.

## Handoff

Freshly inspect the current head, checks, reviews, threads, and mergeability before declaring readiness. Reconcile concurrent changes. Ready means:

- Required validation and applicable CI passed for the current head, with no required checks missing.
- Codex completed review covering that head; all actionable findings and questions have evidenced dispositions, with no valid unresolved finding.
- Fixed findings have commit-linked replies, the description is current, and no merge conflicts remain.

Mark qualifying drafts ready unless requested otherwise. Report each PR's link, readiness, verified commit, check/review evidence, and any blocker or unfinished polish. Human approval and merge remain with the user.
