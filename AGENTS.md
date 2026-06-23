# AGENTS.md

Instructions for AI coding agents (and humans) working **on this repository**.
This file describes the repo itself — it is *not* the PR reviewer's persona.
The review agent's behavior is defined in
[`skills/code-review/SKILL.md`](skills/code-review/SKILL.md).

## What this is

A pnpm-workspace monorepo of [Flue](https://flueframework.com) agents. Today it
holds one agent — a pull-request review agent — with room for more under
`workflows/`.

- **Runtime:** Flue `0.11.1`, TypeScript, Node ≥ 22.18.0, pnpm.
- **Layout:** root layout (agents in `./workflows`, not `./.agents`).

## Project map

| Path | What |
| ---- | ---- |
| `workflows/*.ts` | Agent entrypoints. Each file is one agent. |
| `skills/<name>/SKILL.md` | Global skills, statically imported and registered on an agent. |
| `prompts/*.md` | Global prompt guidance loaded at runtime. |
| `personas/*.ts` | `defineAgentProfile()` subagents, exported via `personas/index.ts`. |
| `app.ts` | Runtime app entry; registers model providers (e.g. GitHub Models) and exports `flue()`. |
| `actions/pr-review/` | Composite GitHub Action consuming repos use. |
| `examples/` | Copy-paste consumer workflow + a sample `.agents/` override. |
| `flue.config.ts` | Default build/run target (node). |

## Commands

```bash
pnpm install            # install deps (uses pnpm-lock.yaml)
pnpm build              # flue build -> dist/server.mjs
pnpm review -- --payload '{"prNumber":123,"repo":"owner/name"}'   # run the agent locally
npx -p typescript tsc --noEmit -p tsconfig.json                   # type-check
```

Validate changes with **both** `pnpm build` and the `tsc` check before
finishing.

## Conventions

- **Adding an agent:** add `workflows/<name>.ts` (shares the globals here) or
  promote it to its own package under `packages/*` and list it in
  `pnpm-workspace.yaml`.
- **Adding a global skill:** create `skills/<name>/SKILL.md`, import it in the
  workflow with `… with { type: 'skill' }`, add it to the `skills` array.
- **Adding global prompts:** drop a `prompts/*.md` file — no code change.
- **Adding a persona:** create `personas/<name>.ts` exporting
  `defineAgentProfile(...)` and add it to `personas/index.ts`.
- The `*.md` skill import is typed loosely in `flue-env.d.ts`; Flue's Vite build
  resolves the real type. Don't tighten it unless Flue ships a proper type.

## Distribution

Consuming repos call the composite action (`actions/pr-review`) and may ship an
`.agents/` directory to override skills/prompts/personas per repo. See
[`actions/pr-review/README.md`](actions/pr-review/README.md).
