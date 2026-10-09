# Saved payment methods

Vocabulary for storing and reusing customer cards through the acquirer's vault.

## Language

**Saved payment method**:
A customer's card stored at the acquirer, represented in the shop only by a token and display metadata.
_Avoid_: stored card, card on file, wallet

**Payment token**:
The acquirer's opaque reference to a stored card. Only valid with the acquirer account that issued it.
_Avoid_: card ID, vault key

**Card fingerprint**:
The acquirer's stable identifier for the underlying card number. Detects duplicates without us seeing the number.

**Customer-initiated payment**:
A charge made while the customer is at checkout and able to complete a challenge. Saved methods are only used this way.
_Avoid_: one-click payment

**Step-up**:
An extra authentication challenge (3-D Secure) the acquirer requires before approving a payment.
_Avoid_: 3DS popup
