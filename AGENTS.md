# AGENTS.md

Instructions for AI coding agents (and humans) working **on this repository**.
This file describes the repo itself — it is *not* the PR reviewer's persona.
The review agent's behavior is defined in
[`skills/code-review/SKILL.md`](skills/code-review/SKILL.md).

## What this is

A pnpm-workspace monorepo of [Flue](https://flueframework.com) agents. Today it
holds one agent — a pull-request review agent — with room for more under
`workflows/`.

- **Runtime:** Flue `0.11.1`, TypeScript, Node `>=22.18.0`, pnpm.
- **Layout:** root layout (agents in `./workflows`, not `./.agents`).

## Project map

| Path | What |
| ---- | ---- |
| `workflows/*.ts` | Agent entrypoints. Each file is one agent. |
| `skills/<name>/SKILL.md` | Global skills, statically imported and registered on an agent. |
| `prompts/*.md` | Global prompt guidance loaded at runtime. |
| `personas/*.ts` | `defineAgentProfile()` subagents, exported via `personas/index.ts`. |
| `app.ts` | Runtime app entry; exports `flue()`. Register extra model providers here. |
| `lib/model.ts` | `requireModel()` — every agent must be given a provider-qualified model; there is no default. |
| `actions/pr-review/` | Composite GitHub Action consuming repos use. |
| `CHANGELOG.md` | Release log. Both actions share one repo-level version. |
| `examples/` | Copy-paste consumer workflow + a sample `.agents/` override. |
| `flue.config.ts` | Default build/run target (node). |

## Commands

```bash
pnpm install            # install deps (uses pnpm-lock.yaml)
pnpm build              # flue build -> dist/server.mjs
REVIEW_MODEL=cloudflare-workers-ai/@cf/moonshotai/kimi-k2.6 \
  pnpm review -- --payload '{"prNumber":123,"repo":"owner/name"}'  # run the agent locally
npx -p typescript tsc --noEmit -p tsconfig.json                   # type-check
```

Validate changes with **both** `pnpm build` and the `tsc` check before
finishing.

## Conventions

- **Adding an agent:** add `workflows/<name>.ts` (shares the globals here) or
  promote it to its own package under `packages/*` and list it in
  `pnpm-workspace.yaml`. Resolve its model with
  `requireModel(ctx.env.<NAME>_MODEL, '<NAME>_MODEL')` — never hard-code one.
- **Models:** no default model and no default provider. Each agent reads its own
  `*_MODEL` env var (set by the composite action's required `model` input in CI,
  or `.env` locally); provider credentials come from the environment.
- **Adding a global skill:** create `skills/<name>/SKILL.md`, import it in the
  workflow with `… with { type: 'skill' }`, add it to the `skills` array.
- **Adding global prompts:** drop a `prompts/*.md` file — no code change.
- **Adding a persona:** create `personas/<name>.ts` exporting
  `defineAgentProfile(...)` and add it to `personas/index.ts`.
- The `*.md` skill import is typed loosely in `flue-env.d.ts`; Flue's Vite build
  resolves the real type. Don't tighten it unless Flue ships a proper type.

## Releasing

Both actions ship together under one repo-level semver tag; `package.json`
holds the declared version and the release workflow refuses a tag that doesn't
match it.

1. Bump `version` in `package.json`, move the heading in `CHANGELOG.md`.
2. Merge to `main`, then `git tag vX.Y.Z && git push origin vX.Y.Z`.
3. `.github/workflows/release.yml` validates the tag, moves the `vX` alias
   consumers pin, and publishes the release.

A change to an action's inputs or to the credentials a consumer must supply is
a **breaking** change — consumers pin `@v1` and expect neither to move.

## Distribution

Consuming repos call the composite action (`actions/pr-review`) and may ship an
`.agents/` directory to override skills/prompts/personas per repo. See
[`actions/pr-review/README.md`](actions/pr-review/README.md).
