# Flue PR Review — composite action

Drop AI code review into any repo. The review logic, skills, and prompts are
managed centrally in this repo; consuming repos add one small workflow and
(optionally) their own local overrides.

## Use it in another repo

Add `.github/workflows/pr-review.yml` (see [`examples/consumer-workflow.yml`](../../examples/consumer-workflow.yml)):

```yaml
name: PR Review
on:
  pull_request:
    types: [opened, synchronize, reopened]
permissions:
  contents: read
  pull-requests: write
jobs:
  review:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: <owner>/agents/actions/pr-review@v1
        env:
          CLOUDFLARE_API_KEY: ${{ secrets.CLOUDFLARE_API_KEY }}
          CLOUDFLARE_ACCOUNT_ID: ${{ secrets.CLOUDFLARE_ACCOUNT_ID }}
        with:
          pr-number: ${{ github.event.pull_request.number }}
          model: cloudflare-workers-ai/@cf/moonshotai/kimi-k2.6
```

That's it — open a PR and the agent reviews it. `model` is **required**: the
agent has no default model or default provider, and the provider's credentials
come from the step's `env:`. See [Models](#models) for the supported
providers.

Pin the ref deliberately:

- `@v1` → latest 1.x: fixes and improved review guidance arrive automatically,
  inputs and required credentials don't change under you. **Recommended.**
- `@v1.0.0` → that exact tree, skills and prompts included. Reproducible.
- `@main` → unreleased tip; may break without notice.

Both actions in this repo share one version — see
[Versioning](../../README.md#versioning) and
[`CHANGELOG.md`](../../CHANGELOG.md).

## Inputs

| Input           | Required | Default                 | Description |
| --------------- | -------- | ----------------------- | ----------- |
| `pr-number`     | yes      | —                       | PR number to review. |
| `model`         | yes      | —                       | Provider-qualified review model, e.g. `cloudflare-workers-ai/@cf/moonshotai/kimi-k2.6`. |
| `repo`          | no       | current repo            | `owner/name` of the PR. |
| `override-mode` | no       | `merge`                 | `merge` or `replace` — how local overrides combine with defaults. |
| `local-config-dir` | no    | `.agents`               | Path in the target repo to `.agents`-compatible local overrides. Use workflow-specific directories like `.agents/pr-review` to keep multiple agents isolated. |
| `github-token`  | no       | `github.token`          | Token for `gh` (needs `pull-requests: write`). |

Provider credentials (`ANTHROPIC_API_KEY`, `CLOUDFLARE_API_KEY`,
`CLOUDFLARE_ACCOUNT_ID`, …) are read from the workflow environment — pass them
via `env:` on the `uses:` step (or at the job level) rather than as inputs.
See [Models](#models) for the full list per provider.

## Per-repo overrides (`.agents/`)

A consuming repo can tailor reviews by adding an `.agents/` directory at its root.
Anything present is layered on top of (or replaces) the central defaults according
to `override-mode`:

```
.agents/
  prompts/*.md         # review priorities for this repo
  skills/<name>/SKILL.md   # extra review skills (or a code-review skill to replace the default)
  personas/*.md        # repo-specific reviewer personas for focused passes
```

> The reviewer's own persona lives in the central `code-review` skill. A repo's
> root `AGENTS.md` describes *that* repo — the reviewer reads it for context and
> holds the PR to those standards.

- **`merge` (default):** central defaults apply first, then the repo's local
  files refine them (local wins on conflict).
- **`replace`:** when the repo ships local files of a given kind (e.g. prompts),
  only those are used and the central ones are ignored for that kind. In
  `replace`, a local `skills/code-review/SKILL.md` supersedes the default review
  methodology entirely.

Subdirectories the reviewer doesn't recognize (e.g. a repo's `.agents/commands/`)
are simply ignored, and `README.md` files in `prompts/` and `personas/` are
skipped. If a repo ships no `.agents/` directory, it just gets the central defaults.

When multiple fleet agents run in the same repo, keep their overrides isolated by
putting them in workflow-specific directories and setting `local-config-dir`:

```yaml
- uses: <owner>/agents/actions/pr-review@v1
  with:
    pr-number: ${{ github.event.pull_request.number }}
    model: cloudflare-workers-ai/@cf/moonshotai/kimi-k2.6
    local-config-dir: .agents/pr-review
```

The directory still uses the same shape (`prompts/`, `skills/`, `personas/`) as
`.agents/`.

## How it works

The action runs in the consuming repo's CI. `github.action_path` is the
checked-out agents repo, so the agent's code, skills, and prompts come along for
free at the pinned ref. The action installs deps, then runs
`flue run pr-review`, passing the PR coordinates plus the paths to the central
config (`REVIEW_AGENT_DIR`), the consumer's checkout (`REVIEW_TARGET_DIR`), and
the selected local override directory (`REVIEW_LOCAL_CONFIG_DIR`, defaulting to
`.agents`). The `code-review` skill resolves the layered guidance, fetches the
diff with `gh`, reviews, and posts the result.

## Models

The action ships **no default model and no default provider** — `model` is a
required input, and the action fails fast if it isn't provider-qualified as
`<provider>/<model>`. Provider credentials are read from the process
environment, so pass them via `env:` on the calling step (or at job level), not
as action inputs.

- **Cloudflare Workers AI.** Set
  `model: cloudflare-workers-ai/@cf/moonshotai/kimi-k2.6` (262k context,
  reasoning, vision, tool calls) and expose `CLOUDFLARE_API_KEY` (a token
  with `Workers AI` → Read scope) + `CLOUDFLARE_ACCOUNT_ID`:
  ```yaml
  - uses: <owner>/agents/actions/pr-review@v1
    env:
      CLOUDFLARE_API_KEY:    ${{ secrets.CLOUDFLARE_API_KEY }}
      CLOUDFLARE_ACCOUNT_ID: ${{ secrets.CLOUDFLARE_ACCOUNT_ID }}
    with:
      pr-number: ${{ github.event.pull_request.number }}
      model:     cloudflare-workers-ai/@cf/moonshotai/kimi-k2.6
  ```
  No `app.ts` registration is needed — Flue resolves the model through
  pi-ai's built-in `cloudflare-workers-ai` catalog. Reasoning works because
  the catalog flags the model as reasoning-capable and the
  `openai-completions` adapter maps `maxTokens` → `max_completion_tokens`
  accordingly.
- **Anthropic.** Set `model: anthropic/claude-sonnet-4-6` and expose
  `ANTHROPIC_API_KEY`:
  ```yaml
  - uses: <owner>/agents/actions/pr-review@v1
    env:
      ANTHROPIC_API_KEY: ${{ secrets.ANTHROPIC_API_KEY }}
    with:
      pr-number: ${{ github.event.pull_request.number }}
      model:     anthropic/claude-sonnet-4-6
  ```
- **Another provider.** Anything in pi-ai's catalog works by id. For a provider
  it doesn't know, register it with `registerProvider(...)` in the agents repo's
  `app.ts`.

Locally, set `REVIEW_MODEL` plus that provider's credentials in `.env`.

> **Pick a model with room for the diff.** A review of a non-trivial PR makes
> several model calls, and the system prompt + skill + diff have to fit in one
> request. Small context windows (or a provider's free-tier per-request token
> cap) will truncate or fail on real PRs.

## Alternative: reusable workflow

Prefer a reusable workflow over a composite action? Convert
`.github/workflows/pr-review.yml` to `on: workflow_call` with the same inputs;
consumers then use:

```yaml
jobs:
  review:
    uses: <owner>/agents/.github/workflows/pr-review.yml@v1
    secrets: inherit
```
