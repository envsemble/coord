import type { Gateway } from "./payments";

export interface Line {
  sku: string;
  quantity: number;
  price: number;
}

/** A customer's order on its way to payment. */
export class Checkout {
  lines: Line[] = [];
  card?: string;
  constructor(private readonly gateway: Gateway) {}
  total(): number {
    return this.lines.reduce(
      (sum, line) => sum + line.price * line.quantity,
      0,
    );
  }
  pay(card: string): Promise<string> {
    this.card = card;
    return this.gateway.charge(this.total(), card);
  }
}
