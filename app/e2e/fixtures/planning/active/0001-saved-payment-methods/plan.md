---
schema_version: 2
kind: plan
id: work-0001
title: Saved payment methods
created: "2026-09-02"
updated: "2026-09-30"
design_status: accepted
implementation_status: in_progress
accepted_at: "2026-09-15"
completed_at: null
supersedes: []
superseded_by: null
continues: [work-0004]
---

# Saved payment methods

## Outcome

Returning customers can pay with a card they saved earlier instead of re-entering it. In August, 9% of checkouts by repeat customers were abandoned at the card step; this is the step we are removing for them.

## Scope

In scope:

- Save a card during checkout (explicit opt-in, unticked by default) and from the account page.
- List saved cards, choose a default, remove a card.
- Pay with a saved card at checkout, including 3-D Secure step-up when the acquirer asks for it.

Out of scope:

- Wallets (Apple Pay, Google Pay). Separate work once this lands.
- Merchant-initiated charges (subscriptions, re-charging after a failed capture). A saved card is only charged while the customer is at checkout.
- Importing cards from anywhere. We have never stored any.

## Current checkout

Checkout authorises a one-off `CardSession` created by the acquirer's hosted fields and captures it at dispatch. Nothing card-related outlives that session. The [captured TypeScript model](diagrams/checkout-capture.puml) of `shop` is the baseline the proposal below changes: [CheckoutService](diagrams/checkout-capture.puml#CheckoutService), [PaymentGateway](diagrams/checkout-capture.puml#PaymentGateway), [CardSession](diagrams/checkout-capture.puml#CardSession) and [Payment](diagrams/checkout-capture.puml#Payment).

## Data model

- A `SavedPaymentMethod` belongs to one customer and holds an acquirer `PaymentToken` plus display metadata: brand, last four digits, expiry. No card number or CVC, ever ([ADR 0001](docs/adr/0001-acquirer-tokens-only.md)).
- `PaymentToken` is provider + opaque value + card fingerprint. The fingerprint stops the same card being saved twice by one customer.
- The default is a flag on the method, not a pointer on `Customer`. Switching default is one write, and removing a method can't leave a dangling pointer.
- `Payment.savedPaymentMethodId` records which saved method paid, for support and refunds.
- `PaymentMethodVault` is our port to the acquirer's vault. `PaymentGateway.authoriseWithToken` charges a token.

The [proposed payment methods](diagrams/checkout-proposal.puml#SavedPaymentMethod) show [the token](diagrams/checkout-proposal.puml#PaymentToken), [the brand](diagrams/checkout-proposal.puml#CardBrand) and [the vault](diagrams/checkout-proposal.puml#PaymentMethodVault); the [alternative](diagrams/checkout-alternative.puml#Customer) keeps the methods on the customer.

## Checkout flow

1. The customer picks a saved method; the default is preselected.
2. `CheckoutService.placeOrderWithSavedMethod` reserves stock as today, then calls `authoriseWithToken`.
3. If the acquirer answers `challenge_required`, the client completes 3-D Secure and checkout resumes with the same reservation. The 15-minute reservation hold covers this.
4. A decline leaves the saved method in place. The customer can pick another or enter a new card.

In the [proposal](diagrams/checkout-proposal.puml#CheckoutService): [PaymentGateway](diagrams/checkout-proposal.puml#PaymentGateway) and [AcquirerGateway](diagrams/checkout-proposal.puml#AcquirerGateway).

## Edge cases

- **Expired card**: hidden at checkout, shown greyed out in the account page with "Update". Not deleted automatically.
- **Removed during checkout**: an authorisation already sent goes through; removal applies to later checkouts.
- **Same card saved twice**: fingerprint match keeps the existing method and updates its expiry.
- **Account deletion**: the deletion job revokes every token at the acquirer, not only our rows. This is part of erasure, not a nice-to-have.
- **Token revoked by the acquirer** (card reissued): the next authorisation fails with `token_invalid`; mark the method revoked and ask for a new card.

## Rollout

- Behind the `checkout.saved_methods` flag: staff accounts, then 10% of signed-in customers for a week, then everyone.
- Watch approval rate on token payments versus session payments, 3-D Secure challenge rate, and repeat-customer conversion.
- Rollback is turning the flag off. Tokens stay in the vault and work again when it is turned back on.

## Completion checks

- Save, list, set default, remove and pay with a saved card in staging against the acquirer sandbox, including a forced 3-D Secure challenge.
- No card data other than brand, last four and expiry in our database or logs (CI log scan plus review of the vault adapter).
- Account deletion revokes tokens at the acquirer (sandbox check).
- Flag at 100% for a week with no approval-rate drop above one percentage point.
- Required shop PRs merged.
