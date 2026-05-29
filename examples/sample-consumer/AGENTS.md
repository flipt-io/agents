# AGENTS.md

Instructions for AI agents (and humans) working in this repository. This is the
standard repo-context file — the PR reviewer reads it to understand the project
and hold changes to *our* standards. (It is also what your IDE coding agent
reads.)

## What this is

`acme-payments` — the service that moves money for Acme: charges, refunds,
payouts, and the ledger. Correctness and auditability matter more than velocity
here.

- **Stack:** TypeScript, Node 22, PostgreSQL, deployed on ECS.
- **Layout:** `src/api` (HTTP), `src/domain` (ledger + money), `src/jobs`
  (async workers), `db/migrations` (expand/contract migrations).

## Commands

```bash
pnpm install
pnpm test         # unit + integration (spins up Postgres via testcontainers)
pnpm migrate      # apply db/migrations
pnpm dev
```

## Conventions an agent must follow

- Money is **integer minor units** (cents) with an explicit currency. Never a
  float. Rounding is explicit and documented.
- All money mutations go through `src/domain/ledger` — never write balances
  directly.
- HTTP handlers are thin: validate, delegate to a domain service, map the
  result. No business logic in `src/api`.
- Migrations are backwards-compatible (expand/contract); no destructive change
  in the same release as the code that stops using a column.
- Never log PANs or PII.
