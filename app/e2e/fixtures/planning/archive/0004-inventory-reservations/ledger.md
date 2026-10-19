---
schema_version: 2
kind: ledger
work_id: work-0004
updated: "2026-09-24"
blocked: null
steps:
  - title: "Migration 002: stock_reservation and stock_level.reserved"
    status: done
  - title: "Reserve every order line at checkout in one transaction (example/shop#41)"
    status: done
  - title: "Expiry sweeper for abandoned reservations (example/shop#44)"
    status: done
  - title: "Concurrency test in staging, then the flag on for all traffic"
    status: done
---
