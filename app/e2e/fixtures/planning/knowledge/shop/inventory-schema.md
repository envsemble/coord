# Inventory schema notes

Scope: repository `shop`, the inventory tables in `db/migrations` and any code that writes stock.

- **Available stock is `on_hand - reserved`.** Checkout and order code change only `reserved` (through `stock_reservation`); `on_hand` belongs to the warehouse system and the WMS sync.
  Source: [work-0004 plan](../../archive/0004-inventory-reservations/plan.md), data model. Confidence: decision, implemented in shop#41.
- **Every `stock_level` write must check and bump `version`.** The WMS sync overwrites `on_hand` every five minutes; without the version check it races with reservations and oversells.
  Source: [work-0004 ledger](../../archive/0004-inventory-reservations/ledger.md), departures, and [concurrency test](../../archive/0004-inventory-reservations/evidence/concurrency-test-2026-09-22.md). Confidence: reproduced in staging.
- **SQLite lets a non-integer primary key hold NULL** unless the column is declared `NOT NULL`. `stock_reservation.id` is affected (`TEXT PRIMARY KEY`). Declare `NOT NULL` explicitly on new text keys.
  Source: the as-built schema capture in work-0004 (2026-09-24) and SQLite's documented legacy behaviour. Confidence: observed in the schema; fix tracked as shop#47.
