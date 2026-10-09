---
schema_version: 1
kind: ledger
work_id: work-0004
updated: "2026-09-24"
current: null
next: []
blocked: null
---

# Inventory reservations: ledger

## Provenance

- Plan: [plan.md](plan.md) as accepted at planning revision `288e3e8298ac3e57e9a12ab781c89b5b449e7adf`.
- shop: started from `main` at `e90f36a`.

## Progress

- 2026-09-11: Started with migration 002 and reserve/commit/release in checkout. The first staging load test oversold by two units while the WMS stock sync ran: the sync overwrites `on_hand` every five minutes and raced the conditional update. Added the `version` column before merging; the sync now retries on a version mismatch. See departures.
- 2026-09-12: shop#41 merged as `ed76f73`.
- 2026-09-22: Concurrency and expiry checks pass ([evidence](evidence/concurrency-test-2026-09-22.md)).
- 2026-09-23: shop#44 (expiry sweeper) merged as `a5682dc`.
- 2026-09-24: Flag on for all traffic. Captured the as-built inventory schema from the migrated database for the record.

## Departures

- Added `stock_level.version` for optimistic concurrency with the WMS sync. The plan's conditional update alone was not enough once a second writer exists.
- Dropped the proposed `released_at` column. `status` plus `created_at` and `expires_at` answer every question we had, and `expired` is now a status of its own instead of a kind of release.

## Outcome

Complete on 2026-09-24. All completion checks pass, shop#41 and shop#44 are merged, and the flag is on for all traffic.

Follow-up outside this work: the as-built capture shows `stock_reservation.id` as nullable. SQLite lets a non-integer primary key hold NULL unless it is declared `NOT NULL`. Tracked as shop#47 and recorded in [inventory schema notes](../../knowledge/shop/inventory-schema.md).
