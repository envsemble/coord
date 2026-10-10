---
schema_version: 1
kind: ledger
work_id: work-0003
updated: "2026-10-02"
current: null
next: ["Enable the email channel once Mailcourier approves the account", "Bounce and complaint webhook handling", "Staging run of all four topics on both channels"]
blocked: "Mailcourier account approval: DPA signed 2026-09-29; their sending-domain review is pending (ticket MC-48213)."
---

# Customer order notifications: ledger

## Provenance

- Plan: [plan.md](plan.md) as accepted at planning revision `7decbbfa5c5c5cdc7101bf3ff954b4a4462431cb`.
- shop: started from `main` at `ed76f73`.

## Progress

- 2026-09-17: Started with the outbox and in-app channel, which don't depend on Mailcourier. Requested the Mailcourier account the same day.
- 2026-09-29: DPA signed and returned to Mailcourier.
- 2026-09-30: shop#52 merged as `7f1b6d6`: outbox, in-app channel, dedupe key and per-topic mute. Verified in staging: four topics in-app, replay of 200 events produced no duplicates.
- 2026-10-02: Mailcourier's domain review is still pending, with no date given. Email delivery, webhooks and the email-off setting wait for it. In-app is live for everyone.

## Delivered so far

In-app notifications for all four topics, with dedupe and mute. Remaining: the email channel, bounce/complaint handling, the email-off setting, and the full staging run.
