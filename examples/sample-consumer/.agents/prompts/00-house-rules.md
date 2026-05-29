# House rules (sample consumer prompt override)

Repo-specific review priorities. In `merge` mode these are applied on top of the
central priorities; in `replace` mode they are used instead of them.

## Money

- Amounts are integer minor units (cents). Reject `float`/`Decimal`-as-float for
  money. Multiplication/division on amounts must round explicitly and document
  the rounding direction.
- Currency must travel with every amount. Flag bare amounts with no currency.

## Idempotency & retries

- External calls to payment processors must carry an idempotency key derived
  from the business operation, not a random UUID generated per attempt.
- Webhook handlers must tolerate duplicate delivery (at-least-once).

## Data

- No PII or PAN (card numbers) in logs, error messages, or test fixtures.
- New tables/columns holding customer data need a retention note in the PR.
