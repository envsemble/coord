---
schema_version: 2
kind: ledger
work_id: work-0001
updated: "2026-10-08"
blocked: null
steps:
  - title: "Domain model and the PaymentMethodVault port (shop#58)"
    status: done
  - title: "Sandbox check of step-up on reuse"
    status: done
  - title: "Add authoriseWithToken to the acquirer gateway, with the challenge_required path (shop#58)"
    status: doing
  - title: "Wire placeOrderWithSavedMethod into checkout"
    status: todo
  - title: "Account page: list, set default, remove"
    status: todo
  - title: "Revoke tokens in the account-deletion job"
    status: todo
  - title: "Sandbox run with a forced 3-D Secure challenge"
    status: todo
---

# Saved payment methods: ledger

## Provenance

- Plan: [plan.md](plan.md) as accepted at planning revision `2d6e33339b7717b96177a2c210dc6dabd870c6a0`.
- shop: started from `main` at `7f1b6d6` on branch `feature/saved-payment-methods`.
- Design diagram: "Checkout · proposed payment methods" (Atlas proposal over the 2026-09-14 TypeScript capture).

## Progress

- 2026-09-30: Started. Sandbox credentials with the vault product enabled arrived the same day.
- 2026-10-03: shop#58 (draft) adds `SavedPaymentMethod`, `PaymentToken`, `CardBrand` and the `PaymentMethodVault` port at `2d8522d`. Matches the proposal, including the default flag on the method.
- 2026-10-08: Sandbox check of step-up on reuse ([evidence](evidence/sandbox-step-up-2026-10-08.md)). Cards saved without authentication get `challenge_required` on first reuse; the planned flow already covers it. Recorded in [payments constraints](../../knowledge/shop/payments-constraints.md).

## Departures

None.
