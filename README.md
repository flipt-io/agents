# Flipt Agents

A collection of [Flue](https://flueframework.com) agents for the Flipt
organization. It's one pnpm-workspace monorepo: each agent is a workflow in
`workflows/`, and they share common infrastructure — model providers (`app.ts`),
the [GitHub Models](https://docs.github.com/en/github-models) default
(`github/openai/gpt-4.1`, no API key required), CI patterns, and reusable
skills / prompts / personas.

The first agent is **PR Review**; more will be added over time.

## Agents

| Agent | What it does | How it runs |
| --- | --- | --- |
| **PR Review** (`workflows/pr-review.ts`) | Reviews a pull request against the target repo's conventions and posts a verdict + findings. | A composite GitHub Action other repos call — see [the PR Review agent](#the-pr-review-agent). |
| _…more soon_ | | |

Adding one is cheap — see [Adding an agent](#adding-an-agent).

## Layout

```
agents/                       # pnpm workspace root — a fleet of agents
  workflows/
    pr-review.ts              # one file per agent (PR Review is the first)
  skills/
    code-review/SKILL.md      # skills agents register (code-review is PR Review's)
  prompts/
    *.md                      # prompt guidance loaded at runtime
  personas/
    *.ts                      # subagents an agent can delegate to
  AGENTS.md                   # docs for agents working ON this repo (not the reviewer's persona)
  actions/
    pr-review/action.yml      # composite action consuming repos use
  examples/
    consumer-workflow.yml     # copy-paste workflow for a consuming repo
    sample-consumer/.agents/  # example per-repo overrides
  app.ts                      # runtime entry: registers model providers (incl. GitHub Models)
  flue.config.ts              # default target (node)
  .github/workflows/
    pr-review.yml             # dogfoods the action on this repo's PRs
```

## How an agent is built

Every agent here is assembled the same way — PR Review is the worked example:

- **Skills** are registered on the agent in `createAgent({ skills: [...] })`, so
  they are part of the agent, not the payload. Add one: drop
  `skills/<name>/SKILL.md`, import it in `workflows/pr-review.ts`, add it to the
  `skills` array.
- **Prompts** in `prompts/*.md` are read by the `code-review` skill on every run
  (filename order). Drop a file in — it applies to the next PR, no code change.
- **Personas** in `personas/*.ts` are registered as `subagents`, so the reviewer
  can delegate focused deep-dives (`security`, `correctness`, …) on any PR.
- **The reviewer's persona and standing rules** live in
  `skills/code-review/SKILL.md` — that skill *is* the agent's behavior.
- **AGENTS.md** documents *this repo* for any coding agent working on it. Flue
  auto-discovers it at runtime, so the review process keeps project context, but
  it is not the reviewer's persona. Per-review context about the code being
  reviewed comes from the *target* repo's own `AGENTS.md`.
- **Posting is deterministic, done by the workflow — not the model.** The
  `code-review` skill only *analyzes* and returns `{ verdict, summary,
  findings }`; `workflows/pr-review.ts` renders that and posts the review via
  `gh`. (Smaller models can't be trusted to reliably run the post step.)
- **MCP tools** can be attached at runtime: `connectMcpServer(url)`, then pass
  the connection's `tools` to `init(agent, { tools })`. PR Review connects the
  Flipt docs MCP so it can ground reviews in the documentation.

The payload only ever carries *which* PR to review (`prNumber`, optional
`repo`) — never the skills or prompts.

## Subagents / personas

Flue supports subagents via `defineAgentProfile({ name, instructions })`,
registered in `createAgent({ subagents: [...] })` and invoked with
`session.task(text, { agent: 'name' })`. There is no markdown auto-discovery for
personas (that exists only for skills), so each persona is a small TS module in
`personas/` exported through `personas/index.ts`. Add one and add it to that
array.

## Models

Default: **`github/openai/gpt-4.1`** via [GitHub Models](https://docs.github.com/en/github-models)
(registered in `app.ts`), authenticated by a GitHub token with `models: read` —
no Anthropic key. On a **free** plan GitHub caps requests at ~8k tokens (too
small for big diffs); a **paid** plan lifts that to production limits, which is
what makes real reviews fit.

Override per run with `REVIEW_MODEL` (locally) or the action's `model` input
(CI):

- another GitHub model (e.g. `github/openai/gpt-4o`),
- `anthropic/claude-sonnet-4-6` (also set `ANTHROPIC_API_KEY`),
- `cloudflare-workers-ai/@cf/moonshotai/kimi-k2.6` for Kimi K2.6 on Cloudflare
  Workers AI — 262k context, reasoning, vision, tool calling, at $0.95/$4.00
  per M input/output tokens. Set `CLOUDFLARE_API_KEY` (a token with
  `Workers AI` → Read) and `CLOUDFLARE_ACCOUNT_ID`. No `app.ts` change is
  needed: Flue resolves it through pi-ai's built-in `cloudflare-workers-ai`
  catalog, which already flags the model as reasoning-capable.

The `github/openai/gpt-5*` family is a reasoning model that needs the responses
API / `max_completion_tokens` on the locally registered GitHub Models provider,
which isn't wired up yet — it'll 400 through chat-completions. Reasoning models
via `cloudflare-workers-ai/*` work today because the openai-completions adapter
sends `max_completion_tokens` automatically when pi-ai's catalog marks the
model as reasoning-capable. See
[`actions/pr-review/README.md`](actions/pr-review/README.md#models).

## The PR Review agent

Reviews a pull request against the target repo's conventions and posts a
verdict + findings. It's packaged as a composite GitHub Action other repos call,
and connects the Flipt docs MCP (`docs.flipt.io/mcp`, no auth) so it can ground
findings in the documentation. Override or disable that via `REVIEW_DOCS_MCP_URL`.

### Use it in other repos

Consuming repos opt in with a small workflow that calls the composite action;
the review logic, skills, and prompts stay centralized here. See
[`actions/pr-review/README.md`](actions/pr-review/README.md) and
[`examples/consumer-workflow.yml`](examples/consumer-workflow.yml).

```yaml
# .github/workflows/pr-review.yml in the consuming repo
permissions:
  contents: read
  pull-requests: write   # required: the workflow posts the review
  models: read           # GitHub Models auth (no API key)
jobs:
  review:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: <owner>/agents/actions/pr-review@main   # @main = always-latest; pin @v1 for reproducible
        with:
          pr-number: ${{ github.event.pull_request.number }}
```

> **Action visibility:** GitHub only lets a **private** action be consumed by
> **private** repos in the org. If the consumer is public (or you just want the
> simplest setup), make `agents` public. For fork PRs on a public repo, the
> consumer must trigger on `pull_request_target` (so the job gets a writable
> token + model access) — see [`examples/consumer-workflow.yml`](examples/consumer-workflow.yml).

### Per-repo overrides

A consuming repo can tailor reviews with an `.agents/` directory at its root
(`prompts/`, `skills/`, `personas/`), so it can hold overrides for every fleet
agent, not just this one. The `override-mode` input controls whether those
`merge` with the central defaults (default) or `replace` them. Full details in
[`actions/pr-review/README.md`](actions/pr-review/README.md).

### Run it locally

```bash
cp .env.example .env        # GITHUB_MODELS_TOKEN (models:read) + GH_TOKEN for gh
pnpm install
pnpm exec flue run pr-review --payload '{"prNumber": 123, "repo": "owner/name"}'
```

`flue run` builds the project, invokes the workflow, and prints the structured
verdict as JSON.

## Adding an agent

Add `workflows/<name>.ts` — it shares everything above: the model providers in
`app.ts`, the GitHub Models default, and the skills / prompts / personas
patterns. Give it its own skill(s) under `skills/`, prompt guidance under
`prompts/`, and personas under `personas/` as needed, then register them on the
agent. Run it with `flue run <name>`, and (if it should be consumable by other
repos) add an action under `actions/<name>/`.

For independent builds/deploys, promote an agent into its own package under
`packages/*` and list it in `pnpm-workspace.yaml`.
