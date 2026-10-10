---
schema_version: 1
kind: plan
id: work-0004
title: Inventory reservations at checkout
repositories: [shop]
created: "2026-09-09"
updated: "2026-09-24"
design_status: accepted
implementation_status: complete
accepted_at: "2026-09-10"
completed_at: "2026-09-24"
supersedes: []
superseded_by: null
---

# Inventory reservations at checkout

## Problem

In the 30 August sale we sold 212 units we did not have, across 37 SKUs, and refunded 140 orders after taking payment. Stock was only decremented when payment was captured, so concurrent checkouts all saw the same available quantity.

## Outcome

Stock is held for an order from "Place order" until payment succeeds or fails, so two customers can't buy the last unit. Holds from abandoned checkouts go back on sale by themselves.

## Reservation lifecycle

A reservation is **held** when checkout starts, then ends in exactly one of:

- **committed**: payment authorised and the order saved;
- **released**: payment declined or checkout failed;
- **expired**: no outcome within 15 minutes, found by the sweeper.

Ended reservations never change again. Fifteen minutes covers a 3-D Secure challenge (p99 four minutes) with margin.

## Data model

- A new `stock_reservation` row per order line per warehouse, referencing `stock_level (warehouse_id, sku)`.
- `stock_level.reserved` holds the reserved quantity. Available stock is `on_hand - reserved`; checkout never writes `on_hand`.
- Migration 002 only adds; old code keeps working against the new schema.

## Concurrency

All lines of an order are reserved in one transaction with a conditional update (`reserved = reserved + :qty WHERE on_hand - reserved >= :qty`). If any line updates zero rows, the whole order fails with insufficient stock and nothing is held.

## Decisions

- Reserve at checkout, not when adding to cart: [ADR 0001](docs/adr/0001-reserve-at-checkout.md).

## Rollout

Deploy migration 002, then the code behind `inventory.reservations`. Turn the flag on for all traffic once the concurrency test passes in staging.

## Completion checks

- 50 parallel checkouts for 10 units in stock produce exactly 10 orders and 40 insufficient-stock errors.
- An abandoned reservation is back in available stock within two minutes of expiring.
- shop#41 and shop#44 merged; flag on for all traffic.
