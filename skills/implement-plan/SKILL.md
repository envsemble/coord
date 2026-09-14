---
name: implement-plan
description: Manual-only support for carrying out the user's plan, with lightweight progress tracking, adversarial review, and PR readiness through babysit-pr. Use only when explicitly invoked as $implement-plan or by name.
---

# Implement Plan

Implement the user's plan in full. The plan and invoking prompt are the primary source of direction: they define scope, outcomes, implementation choices, and any specified sequence. This skill supports that work with progress visibility and review; it must not replace, reinterpret, or reorganize the plan into its own workflow. Explicit user instructions take precedence over this skill.

Keep most effort and attention on completing the planned work. Apply the supporting steps when relevant rather than treating these headings as a mandatory execution sequence. Keep bookkeeping proportional to the task, reuse existing progress records, and avoid restating the plan or introducing additional deliverables. PR readiness supports completion; it is not a substitute for fulfilling the plan.

Carry the work through to PRs ready for human review and subsequent human-authorized merge. Do not stop at code written, PR opened, or CI started. Never claim completion while required work or validation remains.

## Scope and authorization

Invocation requests implementation of the selected plan, creation and updates of its PRs, requests for Codex review on GitHub, and replies to findings on those PRs. Follow higher-priority permission rules. It does not authorize merging, enabling auto-merge, deploying, changing protections, or unrelated external messages. Do not ask again for actions already authorized.

Use the task's existing scope and accepted amendments across all involved repositories. A formal plan is not required. Never silently drop requirements or expand scope.

## Establish a completion ledger

For each involved repository, identify required validation, PR conventions, and the Codex review mechanism. Verify GitHub access early so unavailable delivery gates are visible before handoff.

Use a concise user-accessible progress record that follows the plan's existing work items. Reuse an existing checklist or task file; otherwise maintain a small Markdown ledger outside tracked product files unless repository convention requires them. Share its location so the user can inspect it mid-task. Update it at meaningful milestones, without interrupting implementation for routine bookkeeping. Record only what is useful:

- Requested work items with pending, in-progress, complete, or blocked status, their affected repositories, and links to relevant changes and verification evidence.
- Dependencies within and across repositories, assumptions, accepted scope changes, and actual blockers.
- Each PR's repository, URL, current head commit, CI results, Codex-reviewed commit, findings, and fixing commits.

Include the current activity and next outstanding action so the user can see where things stand. Keep enough context for another agent to resume the workflow. Mark work complete only when evidence supports it.

## Adversarial review

Use adversarial subagents to challenge the implementation; do not rely only on your own assessment. Choose their scope and approach based on the implementation, and give each reviewer only the relevant requirements, decisions, and exclusions grounded in the plan. Check findings against that context before acting; distinguish defects from proposed plan changes. Address valid findings before handoff.

## Prepare the PRs

Apply completion gates to every PR across all involved repositories and to the combined result. Link related PRs and document dependencies and any required merge order so human reviewers can assess the complete change.

Prepare complete PR metadata using the task context and each repository's conventions: link relevant issues and related work, associate the appropriate existing project and milestone when applicable, and apply relevant labels. Use closing references only for issues the PR actually resolves. Ground these associations in the requested work; do not invent tracking items or assign unrelated metadata merely to fill fields.

Inspect each final diff for accidental files and unrelated changes, push the changes, and create or update the corresponding PR. Use drafts while gates remain incomplete where supported.

Write a self-contained title and description for a reviewer who has not seen the conversation. Lead with the problem and resulting behavior. Include implemented scope, relevant design choices, validation performed and results, and material migration, compatibility, or operational considerations. Follow the repository template. Update the description as implementation changes; remove abandoned approaches and obsolete validation claims.

## Bring every PR to readiness

Load and follow [babysit-pr](../babysit-pr/SKILL.md) for every PR. This is an explicit workflow dependency even though both skills are manual-only. Supply the PR URLs, task scope, and existing ledger; keep one shared progress record. That skill owns CI monitoring, review requests, finding resolution and commit-linked replies, conflict resolution, current PR documentation, and per-PR readiness checks. If it cannot be loaded, report the missing dependency rather than claiming these gates are satisfied.

After fixes, recheck affected dependencies and interactions between repositories. A ready PR does not establish that the combined task is complete.

## Final completion gate

Before handoff, confirm:

- The full plan's intended outcome is achieved; confirm against the plan itself, using the progress record as supporting evidence.
- Required validation across repositories has passed and adversarial review covers the combined change.
- Every PR meets the babysit-pr completion gate for its current commit.
- Related PRs and dependencies are linked and any required merge order is documented.

Conclude with PR links, what changed, validation and reviewed commits, and material limitations. State that PRs are ready for human review and remain unmerged only when every gate is satisfied. Otherwise identify incomplete gates and the next action; never label partial or blocked work complete.
