# Jacob's Codex Skills

Personal, reusable skills for [Codex](https://openai.com/codex/). This repository is the source of truth for the skills I have written, adapted, or keep handy across projects.

The collection is intentionally small and practical: Cloudflare development, design-to-code work, repository workflows, legal/product reviews, writing, and a few useful automations.

## Install

Codex discovers skills as folders directly inside its skills directory. Clone this repository there to install the complete collection:

```bash
git clone https://github.com/jakubg05/skills.git ~/.codex/skills
```

Or install only one skill into an existing skills directory:

```bash
cp -R ./repo-commit-splitter ~/.codex/skills/
```

On Windows PowerShell, the equivalent is:

```powershell
Copy-Item .\repo-commit-splitter "$env:USERPROFILE\.codex\skills\" -Recurse
```

Restart or refresh Codex after installing a new skill if it does not appear immediately.

## Catalogue

### Cloudflare and Workers

| Skill | What it helps with |
| --- | --- |
| [`agents-sdk`](./agents-sdk) | Stateful AI agents, workflows, realtime apps, MCP servers, and agent UI. |
| [`cloudflare`](./cloudflare) | Broad Cloudflare platform work, with focused references for individual products. |
| [`cloudflare-email-service`](./cloudflare-email-service) | Email Sending, Email Routing, deliverability, and email integrations. |
| [`cloudflare-one`](./cloudflare-one) | Cloudflare One, Zero Trust, SASE, Access, Gateway, WARP, and Tunnel. |
| [`cloudflare-one-migrations`](./cloudflare-one-migrations) | Migration planning from Zscaler, Palo Alto, VPN, SWG, and similar stacks. |
| [`durable-objects`](./durable-objects) | Durable Objects design, implementation, storage, WebSockets, and testing. |
| [`sandbox-migrate-to-next`](./sandbox-migrate-to-next) | Porting stable Cloudflare Sandbox apps to the 1.0 preview package. |
| [`sandbox-next`](./sandbox-next) | Building and changing apps with `@cloudflare/sandbox@next`. |
| [`sandbox-stable`](./sandbox-stable) | Building and changing apps with the stable Sandbox package. |
| [`turnstile-spin`](./turnstile-spin) | End-to-end Cloudflare Turnstile setup and server-side verification. |
| [`workers-best-practices`](./workers-best-practices) | Production reviews and implementation guidance for Workers. |
| [`wrangler`](./wrangler) | Current, retrieval-first guidance for the Wrangler CLI. |

### Design, browser, and performance

| Skill | What it helps with |
| --- | --- |
| [`figma`](./figma) | Fetching Figma context, screenshots, variables, assets, and MCP guidance. |
| [`figma-implement-design`](./figma-implement-design) | Translating Figma nodes into production-ready, visually faithful code. |
| [`playwright`](./playwright) | Browser automation from the terminal with Playwright CLI. |
| [`web-perf`](./web-perf) | Core Web Vitals, dependency chains, layout shifts, and performance audits. |

### Repository and delivery workflows

| Skill | What it helps with |
| --- | --- |
| [`babysit-pr`](./babysit-pr) | Driving existing pull requests through review, fixes, CI, and conflicts. |
| [`implement-plan`](./implement-plan) | Carrying out an explicitly selected implementation plan through PR readiness. |
| [`issue-writing`](./issue-writing) | Concise, actionable issue titles and bodies. |
| [`refactor-codebase`](./refactor-codebase) | Behavior-preserving refactoring with disciplined repository checks. |
| [`repo-commit-splitter`](./repo-commit-splitter) | Turning a working-tree diff into focused local Conventional Commits. |

### Product, legal, and domain thinking

| Skill | What it helps with |
| --- | --- |
| [`domain-modeling`](./domain-modeling) | Sharpening terminology, context documents, and architecture decisions. |
| [`grilling`](./grilling) | Stress-testing a plan or idea through structured questioning. |
| [`grill-with-docs`](./grill-with-docs) | Combining plan interrogation with live glossary and ADR writing. |
| [`legal-oss-review`](./legal-oss-review) | Open-source licence, attribution, dependency, and notice hygiene. |
| [`legal-privacy-review`](./legal-privacy-review) | Data flows, privacy obligations, DPIA/PIA triage, and product-policy drift. |
| [`legal-product-review`](./legal-product-review) | Practical legal risk review for products, launches, and public claims. |
| [`unslop`](./unslop) | Removing AI writing tells while preserving meaning and adding a human voice. |

### Utilities

| Skill | What it helps with |
| --- | --- |
| [`create-daily-excel`](./create-daily-excel) | Creating a sourced Slovak nameday and birthday almanac workbook. |

## Skill layout

Every skill is self-contained and follows the Codex convention:

```text
skill-name/
├── SKILL.md          # required instructions and trigger description
├── references/       # optional supporting guidance
├── scripts/          # optional helper scripts
├── tests/            # optional validation material
└── agents/            # optional UI metadata
```

The folders stay flat on purpose: Codex loads skills from immediate subdirectories of its configured skills directory. The README provides the human-friendly organization without changing that discovery layout.

## Notes

- `SKILL.md` is the authoritative contract for each skill, including trigger rules and safety boundaries.
- Several skills are retrieval-first because Cloudflare, browser tooling, and legal requirements change over time.
- Some skills are intentionally manual-only or require explicit invocation. Check the front matter and opening section of the skill before using it.
- The platform-managed `.system` skills are not copied here; this repository contains the personal collection only.
- Upstream notices and licence files included inside individual skill folders are kept with those skills.

## Contributing

When adding a skill, create a new kebab-case folder with a complete `SKILL.md`, keep supporting material inside that folder, and add one concise row to the appropriate catalogue section above. Prefer small, composable skills over one large instruction file.
