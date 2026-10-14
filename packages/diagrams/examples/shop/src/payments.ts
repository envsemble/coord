/** A payment provider that charges a card. */
export interface Gateway {
  charge(amount: number, token: string): Promise<string>;
}

/** The provider Atlas's example shop pays through today. */
export class LegacyGateway implements Gateway {
  constructor(private readonly apiKey: string) {}
  async charge(amount: number, token: string): Promise<string> {
    return `${this.apiKey}:${token}:${amount}`;
  }
}
