# Reserve stock at checkout, not when adding to cart

We reserve stock when the customer places the order, for at most 15 minutes, rather than when an item goes into the cart. Carts live for three days on average, so cart reservations would hold sellable stock for idle carts and need long expiries and their own abandonment handling. Reserving at checkout closes exactly the window in which the overselling happened. The accepted cost: a product page can show "in stock" and the customer can still lose the last unit at checkout. The low-stock badge on product pages softens this.
