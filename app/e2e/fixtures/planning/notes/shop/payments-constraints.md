# Payments constraints

Scope: repository `shop`, anything that touches card payments (checkout, payments, account pages, logging). Not applicable to other payment types until they exist.

- **No card data in our systems.** Card numbers and CVCs never reach the shop: not in the database, logs, analytics or error reports. Card entry happens only in the acquirer's hosted fields, which keeps us in PCI DSS SAQ A. Saved cards are acquirer tokens plus brand, last four and expiry.
  Source: [work-0001 ADR 0001](../../active/0001-saved-payment-methods/docs/adr/0001-acquirer-tokens-only.md). Confidence: decision.
- **Tokens belong to one acquirer account.** A `PaymentToken` can't be charged through another acquirer or another merchant account. Changing acquirer means a token migration or customers saving their cards again.
  Source: same ADR and the acquirer's vault documentation. Confidence: documented by the acquirer.
- **Cards saved without authentication need step-up on first reuse** (EU customers, SCA). Expect `challenge_required` and route the customer through 3-D Secure; don't treat it as a decline.
  Source: [sandbox run 2026-10-08](../../active/0001-saved-payment-methods/evidence/sandbox-step-up-2026-10-08.md). Confidence: observed in the sandbox only; production not yet observed.
- **Authorisations expire after seven days.** We capture at dispatch, so an order not dispatched within seven days of payment needs a fresh authorisation. Split shipments (work-0002) will make this more common.
  Source: acquirer API reference, authorisation lifecycle. Confidence: documented; we have not yet hit it in production.
