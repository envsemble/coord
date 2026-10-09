# Store acquirer tokens, never card data

Saved cards live in the acquirer's vault. The shop keeps only the token, card fingerprint, brand, last four digits and expiry. Running our own vault would bring the shop database and every service that touches it into PCI DSS scope (SAQ D instead of today's SAQ A), which we cannot staff or audit. The cost is lock-in: tokens cannot follow us to another acquirer without a paid token migration, so a future acquirer switch means either that migration or asking customers to save their cards again.

## Considered options

- **Own encrypted vault**: rejected for PCI scope.
- **Network tokens through an independent vault provider**: portable between acquirers, but adds a vendor and per-token fees for a benefit we don't need yet. Revisit if we plan an acquirer change.
