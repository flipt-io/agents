# Flipt Agents

A collection of [Flue](https://flueframework.com) agents for the Flipt
organization. It's one pnpm-workspace monorepo: each agent is a workflow in
`workflows/`, and they share common infrastructure — model providers (`app.ts`),
the [GitHub Models](https://docs.github.com/en/github-models) default
(`github/openai/gpt-4.1`, no API key required), CI patterns, and reusable
skills / prompts / personas.

The current agents are **PR Review** and **Issue Health Check**. Local builds and
runs require Node 22.18.0 or newer (the Flue 0.11.1 runtime floor) and pnpm.

## Agents

| Agent | What it does | How it runs |
| --- | --- | --- |
| **PR Review** (`workflows/pr-review.ts`) | Reviews a pull request against the target repo's conventions and posts a verdict + findings. | A composite GitHub Action other repos call — see [the PR Review agent](#the-pr-review-agent). |
| **Issue Health Check** (`workflows/issue-health.ts`) | Checks newly opened issues for actionability, missing information, privacy concerns, and existing target-repo labels. | A composite GitHub Action other repos call — see [the Issue Health Check agent](#the-issue-health-check-agent). |

Adding one is cheap — see [Adding an agent](#adding-an-agent).

## Layout

```
agents/                       # pnpm workspace root — a fleet of agents
  workflows/
    pr-review.ts              # one file per agent
    issue-health.ts
  skills/
    code-review/SKILL.md      # skills agents register
    issue-health/SKILL.md
  prompts/
    *.md                      # prompt guidance loaded at runtime
  personas/
    *.ts                      # subagents an agent can delegate to
  AGENTS.md                   # docs for agents working ON this repo (not the reviewer's persona)
  actions/
    pr-review/action.yml      # composite actions consuming repos use
    issue-health/action.yml
  examples/
    consumer-workflow.yml     # copy-paste workflows for consuming repos
    issue-health-workflow.yml
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
- **GitHub mutations are deterministic, done by the workflow — not the model.**
  Skills only *analyze* and return structured data; workflows render comments,
  post them with `gh`, and apply any labels from deterministic code paths.
  (Smaller models can't be trusted to reliably run mutation steps.)
- **MCP tools** can be attached at runtime: `connectMcpServer(url)`, then pass
  the connection's `tools` to `init(agent, { tools })`. PR Review connects the
  Flipt docs MCP so it can ground reviews in the documentation.

The payload only ever carries *which artifact* to inspect (for example
`prNumber` or `issueNumber`, plus optional `repo`) — never the skills or
prompts.

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

Override per run with `REVIEW_MODEL` or `ISSUE_HEALTH_MODEL` (locally), or the
action's `model` input (CI):

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

## The Issue Health Check agent

Checks newly opened GitHub issues for actionability before a maintainer picks
up triage. It fetches the live issue, asks the `issue-health` skill for
structured analysis (`issueType`, `verdict`, hidden internal `score`,
`summary`, `missingInfo`, `suggestedLabels`, and `redactionWarning`), then
renders and posts one deterministic health-check/support comment.

### Use it in other repos

Consuming repos opt in with an `issues.opened` workflow that calls the composite
action. See [`actions/issue-health/README.md`](actions/issue-health/README.md)
and [`examples/issue-health-workflow.yml`](examples/issue-health-workflow.yml).

```yaml
# .github/workflows/issue-health.yml in the consuming repo
on:
  issues:
    types: [opened]
permissions:
  contents: read
  issues: write      # required: the workflow comments and may apply labels
  models: read       # GitHub Models auth (no API key)
jobs:
  issue-health:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: <owner>/agents/actions/issue-health@main
        with:
          issue-number: ${{ github.event.issue.number }}
```

v1 runs only for newly opened issues. It does not respond to edits or reopens,
create labels, edit issue bodies, close issues, or assign people. Labeling is
existing-only by default: the workflow discovers labels from the target repo at
runtime, filters model suggestions against those names, and applies only labels
that already exist there. Set `label-mode: off` to disable labeling.

The default `comment-mode` is `always`, so every opened issue gets one combined
health-check/support comment. Set `comment-mode: needs-improvement` to comment
only for `needs_info` / `not_actionable` results, or `comment-mode: off` to
skip comments. When comments are enabled, the footer links to
[GitHub Sponsors](https://github.com/sponsors/flipt-io) and
[Flipt Pro](https://docs.flipt.io/v2/pro).

### Per-repo overrides

Issue Health Check uses the same `.agents/` override convention as PR Review.
A consuming repo can add local prompts/skills/personas under `.agents/`, and the
action's `override-mode` controls whether those files `merge` with the central
defaults or `replace` them. Full details are in
[`actions/issue-health/README.md`](actions/issue-health/README.md).

### Run it locally

```bash
cp .env.example .env        # GITHUB_MODELS_TOKEN (models:read) + GH_TOKEN for gh
pnpm install
pnpm issue-health -- --payload '{"issueNumber":123,"repo":"owner/name"}'
```

`pnpm issue-health` runs the `flue run issue-health` package script, fetches the
issue from `repo`, posts according to `ISSUE_HEALTH_COMMENT_MODE` (default
`always`), applies labels according to `ISSUE_HEALTH_LABEL_MODE` (default
`existing-only`), and prints the structured result as JSON.

## Adding an agent

Add `workflows/<name>.ts` — it shares everything above: the model providers in
`app.ts`, the GitHub Models default, and the skills / prompts / personas
patterns. Give it its own skill(s) under `skills/`, prompt guidance under
`prompts/`, and personas under `personas/` as needed, then register them on the
agent. Run it with `flue run <name>`, and (if it should be consumable by other
repos) add an action under `actions/<name>/`.

For independent builds/deploys, promote an agent into its own package under
`packages/*` and list it in `pnpm-workspace.yaml`.
