# CONTEXT.md Format

## Structure

```md
# {Context Name}

{One or two sentence description of what this context is and why it exists.}

## Language

**Order**:
{A one or two sentence description of the term}
_Avoid_: Purchase, transaction

**Invoice**:
A request for payment sent to a customer after delivery.
_Avoid_: Bill, payment request

**Customer**:
A person or organization that places orders.
_Avoid_: Client, buyer, account
```

## Rules

- **Be opinionated.** When multiple words exist for the same concept, pick the best one and list the others under `_Avoid_`.
- **Keep definitions tight.** One or two sentences max. Define what it IS, not what it does.
- **Only include terms specific to this project's context.** General programming concepts (timeouts, error types, utility patterns) don't belong even if the project uses them extensively. Before adding a term, ask: is this a concept unique to this context, or a general programming concept? Only the former belongs.
- **Group terms under subheadings** when natural clusters emerge. If all terms belong to a single cohesive area, a flat list is fine.

## Single vs multi-context work items

**Single context (most work items):** One `CONTEXT.md` at `<planning-root>/active/NNNN-descriptive-name/CONTEXT.md`.

**Multiple contexts:** A `CONTEXT-MAP.md` in that work item lists the contexts, where their work-specific glossaries live, and how they relate to each other. Use a map only when the contexts actually need routing:

```md
# Context Map

## Contexts

- [Ordering](./contexts/ordering/CONTEXT.md): receives and tracks customer orders
- [Billing](./contexts/billing/CONTEXT.md): generates invoices and processes payments
- [Fulfillment](./contexts/fulfillment/CONTEXT.md): manages warehouse picking and shipping

## Relationships

- **Ordering → Fulfillment**: Ordering emits `OrderPlaced` events; Fulfillment consumes them to start picking
- **Fulfillment → Billing**: Fulfillment emits `ShipmentDispatched` events; Billing consumes them to generate invoices
- **Ordering ↔ Billing**: Shared types for `CustomerId` and `Money`
```

The skill infers which structure applies:

- If `CONTEXT-MAP.md` exists in the work item, read it to find contexts
- If only a work-item-root `CONTEXT.md` exists, single context
- If neither exists, create a work-item-root `CONTEXT.md` lazily when the first term is resolved

When multiple contexts exist, infer which one the current topic relates to. If unclear, ask. Preserve existing glossary/map conventions and link canonical product vocabulary in its owning repository; do not relocate it or produce competing current truth. Keep the original work-specific glossary and map in the same folder when it moves to `archive/`.
