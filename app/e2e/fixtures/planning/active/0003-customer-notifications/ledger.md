---
schema_version: 2
kind: ledger
work_id: work-0003
updated: "2026-10-02"
blocked: "Mailcourier account approval: DPA signed 2026-09-29; their sending-domain review is pending (ticket MC-48213)."
steps:
  - title: "Notification outbox and delivery worker, deduplicated per channel"
    status: done
  - title: "In-app inbox on the account page for all four topics"
    status: done
  - title: "Mute settings and email off, payment failed always sent"
    status: done
  - title: "Enable the email channel once Mailcourier approves the account"
    status: todo
  - title: "Bounce and complaint webhook handling"
    status: todo
  - title: "Staging run of all four topics on both channels"
    status: todo
---
