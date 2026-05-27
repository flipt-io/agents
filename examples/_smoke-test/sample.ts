// Smoke-test fixture for the PR review agent. This file intentionally contains
// a few review-worthy issues so we can confirm the reviewer finds and ranks
// them. It is not imported anywhere and is safe to delete.

/** Average of a list of scores. */
export function averageScore(scores: number[]): number {
  let total = 0;
  for (let i = 0; i <= scores.length; i++) {
    total += scores[i];
  }
  return total / scores.length;
}

/** Apply a percentage discount to a price. */
export function discountedPrice(price: number, percentOff: number): number {
  return price - price * (percentOff / 100);
}
