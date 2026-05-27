# PR Review Agent

A [Flue](https://flueframework.com) agent that reviews pull requests using
**globally-configured skills and prompts** — they apply to every PR, not per
invocation. Runs in GitHub Actions on [GitHub Models](https://docs.github.com/en/github-models)
(default `github/openai/gpt-4.1`) — no API key required; Anthropic is also
supported. The model analyzes the diff and returns a structured verdict; the
workflow posts the review.

## Layout

```
agents/                       # pnpm workspace root (room for more agents later)
  workflows/
    pr-review.ts              # the agent: registers globals, reviews one PR
  skills/
    code-review/SKILL.md      # GLOBAL skill — the review methodology
  prompts/
    *.md                      # GLOBAL prompts — review priorities, drop-in
  personas/
    *.ts                      # GLOBAL subagents the review can delegate to
  AGENTS.md                   # docs for agents working ON this repo (not the reviewer's persona)
  actions/
    pr-review/action.yml      # composite action consuming repos use
  examples/
    consumer-workflow.yml     # copy-paste workflow for a consuming repo
    sample-consumer/.flue/    # example per-repo overrides
  app.ts                      # runtime entry: registers model providers (incl. GitHub Models)
  flue.config.ts              # default target (node)
  .github/workflows/
    pr-review.yml             # dogfoods the action on this repo's PRs
```

## How "global" works

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
(CI): another GitHub model (e.g. `github/openai/gpt-4o`) or
`anthropic/claude-sonnet-4-6` (also set `ANTHROPIC_API_KEY`). The gpt-5 family
is a reasoning model that needs the responses API / `max_completion_tokens`,
which isn't wired up yet. See
[`actions/pr-review/README.md`](actions/pr-review/README.md#models).

## Use it in other repos

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

A consuming repo can tailor reviews with a `.flue/` directory at its root
(`prompts/`, `skills/`, `personas/`, `AGENTS.md`) — the canonical Flue source
dir, so it can hold overrides for every fleet agent, not just this one. The
`override-mode` input controls whether those `merge` with the central defaults
(default) or `replace` them. Full details in
[`actions/pr-review/README.md`](actions/pr-review/README.md).

## Run it locally

```bash
cp .env.example .env        # GITHUB_MODELS_TOKEN (models:read) + GH_TOKEN for gh
pnpm install
pnpm exec flue run pr-review --payload '{"prNumber": 123, "repo": "owner/name"}'
```

`flue run` builds the project, invokes the workflow, and prints the structured
verdict as JSON.

## Adding more agents

Either add another file under `workflows/` (shares these globals, one build /
deploy), or promote agents into isolated packages under `packages/*` and list
them in `pnpm-workspace.yaml` for independent deploys.
