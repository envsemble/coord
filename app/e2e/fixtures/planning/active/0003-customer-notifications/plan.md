---
schema_version: 1
kind: plan
id: work-0003
title: Customer order notifications
repositories: [shop]
created: "2026-09-08"
updated: "2026-10-02"
design_status: accepted
implementation_status: partial
accepted_at: "2026-09-16"
completed_at: null
supersedes: []
superseded_by: null
---

# Customer order notifications

## Outcome

Customers hear about their order when it matters (confirmed, dispatched with tracking, delivered, payment failed), in the account inbox and by email, and never twice for the same event. Support currently answers about 60 "where is my order" tickets a week that a dispatch email would prevent.

## Scope

- Topics: order confirmed, order dispatched, order delivered, payment failed.
- Channels: in-app inbox on the account page, and transactional email.
- Customers can mute individual topics and turn email off. Payment failed can't be muted, because it needs action.
- Out of scope: SMS, push, and marketing email, which has its own consent rules.

## Design

- Producers write to a notification outbox in the same transaction as the order change; a worker delivers from it. No dual writes to the order store and a mail API.
- Dedupe key `orderId:topic:channel`, at most once per channel. A replayed event never sends a second email.
- Email goes through Mailcourier (EU region). Templates live in Mailcourier; we send the topic and variables.
- Bounces and complaints reported by webhook switch email off for that address.

## Dependencies

- **Mailcourier account approval.** Needs a signed DPA and verification of the sending domain `mail.northwind.example` (SPF, DKIM). Only the email channel depends on it.
- Dispatched and delivered need carrier tracking events. Work-0002 may change the shipment model; topics are keyed on the order, so either model works.

## Completion checks

- All four topics arrive in-app and by email in staging; replaying the events produces no duplicates.
- Muted topics and email-off are respected; payment failed is always sent.
- A bounce or complaint webhook disables email for the address.
- Required shop PRs merged and email enabled in production.
