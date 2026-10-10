# Acquirer sandbox: step-up on saved-card reuse

Run on 2026-10-08 against the acquirer sandbox with shop branch `feature/saved-payment-methods` at `2d8522d`. Test cards from the acquirer's EU SCA set.

| Card saved with | First reuse | Second reuse |
|---|---|---|
| 3-D Secure challenge completed | Approved, no challenge | Approved, no challenge |
| Frictionless 3-D Secure | Approved, no challenge | Approved, no challenge |
| No 3-D Secure (save-only, no payment) | `challenge_required` | Approved after first challenge |

Conclusion: a card saved without authentication triggers step-up on first reuse. The planned checkout flow (step 3) already handles `challenge_required`, so no scope change. Production behaviour is not yet observed; the sandbox mirrors the acquirer's documented SCA rules.
