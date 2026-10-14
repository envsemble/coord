# Northwind planning

This local Git repository holds planned work, implementation records and scoped engineering knowledge for [Northwind Shop](../shop). Start with [AGENTS.md](AGENTS.md) for governance and [PLANS.md](PLANS.md) for work identity, metadata and lifecycle. [planning.json](planning.json) is the authoritative scope/location index and current-plan selector. [plan-frontmatter.md](plan-frontmatter.md) is the minimal metadata example, not a work item.

## Participating projects

| ID | Repository | Checkout |
|---|---|---|
| `shop` | Northwind Shop: storefront domain, checkout, payments, inventory schema | `../shop` |
| `planning` | This repository | `.` |

## Active work

| Work | Status | Entry |
|---|---|---|
| 0001 — Saved payment methods | Accepted; implementation in progress on shop#58 | [Plan](active/0001-saved-payment-methods/plan.md), [ledger](active/0001-saved-payment-methods/ledger.md) |
| 0002 — Order fulfilment model | Draft; conceptual model being grilled | [Plan](active/0002-order-fulfilment-model/plan.md), [glossary](active/0002-order-fulfilment-model/CONTEXT.md) |
| 0003 — Customer order notifications | Accepted; in-app delivered, email blocked on provider approval | [Plan](active/0003-customer-notifications/plan.md), [ledger](active/0003-customer-notifications/ledger.md) |

## Archived work

| Work | Outcome | Entry |
|---|---|---|
| 0004 — Inventory reservations at checkout | Complete 2026-09-24; shop#41 and shop#44 merged | [Plan](archive/0004-inventory-reservations/plan.md), [ledger](archive/0004-inventory-reservations/ledger.md) |

Numbers show registration order, not priority. Current code, tests and the shop's own documentation establish present behaviour; plans record intent and rationale.

## Knowledge

- [Payments constraints](knowledge/shop/payments-constraints.md): PCI scope, token scope, step-up and authorisation expiry for `shop`.
- [Inventory schema notes](knowledge/shop/inventory-schema.md): available-stock rule, WMS sync concurrency and a SQLite key quirk.

## Diagrams

Each work folder keeps its diagrams as PlantUML files beside its plan, so archiving a folder carries its diagrams with it. Diagrams captured from code or a database are dated snapshots of the source; proposals and class diagrams are written during planning, and the plan links each one under the section it explains.
