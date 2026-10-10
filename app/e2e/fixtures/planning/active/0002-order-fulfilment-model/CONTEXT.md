# Order fulfilment

Concepts for getting a paid order from Northwind's warehouses to the customer.

## Language

### Orders

**Order**:
A customer's purchase from the seller, covering one or more order lines.
_Avoid_: purchase, basket

**Seller**:
The organisation an order is placed with. Currently always Northwind.
_Avoid_: merchant, vendor

**Partially shipped**:
An order with at least one dispatched shipment and lines that have no shipment yet.

### Shipments

**Shipment**:
Goods for one order that leave one warehouse together.
_Avoid_: delivery, consignment, dispatch

**Parcel**:
A physical package within a shipment, carrying its own carrier label.
_Avoid_: box, package

**Carrier**:
The organisation that transports a shipment once it is dispatched.
_Avoid_: courier, shipper

**Warehouse**:
A Northwind stock location that ships to customers.
_Avoid_: depot, DC

**Split shipment**:
An order fulfilled by more than one shipment.

**Delivery failed**:
A shipment the carrier could not deliver and has stopped attempting.
