---
schema_version: 1
kind: plan
id: work-0002
title: Order fulfilment model
repositories: [shop]
created: "2026-09-07"
updated: "2026-10-07"
design_status: draft
implementation_status: not_started
accepted_at: null
completed_at: null
supersedes: []
superseded_by: null
---

# Order fulfilment model

Draft, being grilled. Items marked **Settled** are agreed; **Proposed** items are recommendations awaiting a decision.

## Problem

An order ships as exactly one `Shipment` from one warehouse (`src/fulfilment/Shipment.ts`). Since the Leeds warehouse opened, 18% of multi-line orders have lines that are only in stock in different warehouses, and we hold them for a stock transfer that adds two to four days. We want split shipments, and the current types can't say what an order's status is when half of it has left.

## Outcome

An agreed conceptual model of fulfilment (orders, shipments, parcels, carriers, warehouses and their lifecycles) that the code and the notification topics in work-0003 can follow. This plan produces the model and the decisions; changing the code is a separate plan.

## Why a conceptual model first

One-order-one-shipment is encoded in several places: `OrderStatus.Shipped`, the notification topics, and `Shipment.carrier` as a free-text string. Agreeing the concepts before touching the types avoids a second migration. The [class diagram](diagrams/fulfilment.puml) of [orders](diagrams/fulfilment.puml#Order) and [shipments](diagrams/fulfilment.puml#Shipment) is the working artefact for this discussion; it is a draft, not a specification.

## Participants

- **Settled**: An order is between a customer and the seller. The seller is always Northwind today; modelling it as a role keeps marketplace sellers possible without promising them.
- **Settled**: A shipment belongs to exactly one order and leaves from exactly one warehouse. An order has zero or more shipments.
- **Proposed**: A carrier is optional until dispatch, because an allocated shipment has none yet. Parcels exist from packing onwards.

[Order 1042](diagrams/split-order.puml) is split across two warehouses.

## Shipment lifecycle

Allocated → Packed → In transit → Delivered. The phases are exclusive and every shipment is in exactly one of them.

- **Added 2026-10-07**: Delivery failed, when the carrier has stopped trying (bad address, refused). What happens next is open question 1.

## Order status

Open → Partially shipped → Fulfilled, or Cancelled. Derived from the order's shipments, never set directly.

- Partially shipped: at least one shipment is in transit or delivered and some lines have no shipment yet.

## Split shipments

- **Proposed**: Split only by warehouse, never within one warehouse: at most one shipment per warehouse per order.
- **Settled**: Shipping is charged once per order, however many shipments it takes.

## Out of scope

Returns and exchanges, marketplace sellers, carrier rate shopping.

## Open questions

1. After a failed delivery, is the redelivery the same shipment (back to In transit) or a new one? This decides tracking-number history and whether work-0003 sends a second "dispatched" email.
2. Can the unshipped rest of a partially shipped order be cancelled, and is that order then Fulfilled or Cancelled?
3. Can a parcel move to a different shipment (re-packed after damage at the dock)? If so, a parcel's shipment isn't fixed.
4. Is Picking a phase we need here, or only a state inside the warehouse system?
