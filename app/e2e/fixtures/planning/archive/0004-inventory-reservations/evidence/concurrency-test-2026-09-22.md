# Reservation concurrency test

Staging, 2026-09-22, shop `main` at `ed76f73` plus the sweeper branch of shop#44. SKU `NW-MUG-014`, 10 units on hand in Berlin, 50 concurrent checkouts of one unit each, repeated five times.

| Run | Orders placed | Insufficient stock | Other errors | Final `on_hand - reserved` |
|---|---|---|---|---|
| 1 | 10 | 40 | 0 | 0 |
| 2 | 10 | 40 | 0 | 0 |
| 3 | 10 | 40 | 0 | 0 |
| 4 | 10 | 40 | 0 | 0 |
| 5 (WMS sync running) | 10 | 40 | 0 | 0 |

Run 5 forced a WMS stock sync during the burst. Before the `version` column (see ledger, departures) the same scenario oversold by two units on 2026-09-11.

Expiry: 20 checkouts abandoned after reservation; all 20 reservations were `expired` and the units available again 64–118 seconds after `expires_at` (sweeper runs every minute).
