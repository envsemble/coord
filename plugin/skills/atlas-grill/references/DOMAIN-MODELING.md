# Domain Modeling

Actively build and sharpen the project's domain model as you design. This is the *active* discipline: challenging terms, inventing edge-case scenarios, and writing the glossary and decisions down the moment they crystallise (terms in `CONTEXT.md`, decisions in `plan.md`). (Merely *reading* `CONTEXT.md` for vocabulary is not this discipline: that's a one-line habit any skill can do. This discipline is for when you're changing the model, not just consuming it.)

## File structure

Keep work-specific records in the selected planning work item. Most work items have a single context:

```text
<planning-root>/active/NNNN-descriptive-name/
├── plan.md
└── CONTEXT.md
```

If a `CONTEXT-MAP.md` exists in the work item, it points to each context's glossary:

```text
<planning-root>/active/NNNN-descriptive-name/
├── plan.md
├── CONTEXT-MAP.md
└── contexts/
    ├── ordering/
    │   └── CONTEXT.md
    └── billing/
        └── CONTEXT.md
```

Create files lazily: only when you have something to write. If no `CONTEXT.md` exists, create one when the first term is resolved. Use a map only when multiple domain contexts actually require routing. Preserve existing `CONTEXT.md` and map conventions; link canonical product documentation rather than moving it or duplicating a competing account. The whole work item, including these original records, stays together after archiving.

## During the session

### Challenge against the glossary

When the user uses a term that conflicts with the existing language in `CONTEXT.md`, call it out immediately. "Your glossary defines 'cancellation' as X, but you seem to mean Y. Which is it?"

### Sharpen fuzzy language

When the user uses vague or overloaded terms, propose a precise canonical term. "You're saying 'account': do you mean the Customer or the User? Those are different things."

### Discuss concrete scenarios

When domain relationships are being discussed, stress-test them with specific scenarios. Invent scenarios that probe edge cases and force the user to be precise about the boundaries between concepts.

### Cross-reference with code

When the user states how something works, check whether the code agrees. If you find a contradiction, surface it: "Your code cancels entire Orders, but you just said partial cancellation is possible. Which is right?"

### Update CONTEXT.md inline

When a term is resolved, update the work item's `CONTEXT.md` right there. Don't batch these up: capture them as they happen. Use the format in [CONTEXT-FORMAT.md](CONTEXT-FORMAT.md).

`CONTEXT.md` should be totally devoid of implementation details. Do not treat `CONTEXT.md` as a spec, a scratch pad, or a repository for implementation decisions. It is a glossary and nothing else.
