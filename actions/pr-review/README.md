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
  models: read            # default model is github/openai/gpt-4.1
jobs:
  review:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: <owner>/agents/actions/pr-review@main
        with:
          pr-number: ${{ github.event.pull_request.number }}
```

That's it — open a PR and the agent reviews it. The default model
(`github/openai/gpt-4.1`) runs on GitHub Models authenticated by the built-in
`GITHUB_TOKEN` (no API key). See [Models](#models) for free vs. paid limits and
Anthropic.

- `@main` → always uses the latest central skills/prompts.
- `@v1` (a tag) → pins to a released version for reproducible reviews.

## Inputs

| Input               | Required | Default               | Description |
| ------------------- | -------- | --------------------- | ----------- |
| `pr-number`         | yes      | —                     | PR number to review. |
| `anthropic-api-key` | no       | —                     | Anthropic key. Required only for `anthropic/*` models. |
| `model`             | no       | `github/openai/gpt-4.1` | Override the review model. |
| `repo`              | no       | current repo          | `owner/name` of the PR. |
| `override-mode`     | no       | `merge`               | `merge` or `replace` — how local overrides combine with defaults. |
| `github-token`      | no       | `github.token`        | Token for `gh` and GitHub Models (needs `pull-requests: write`, and `models: read` for `github/*`). |

## Per-repo overrides (`.flue/`)

A consuming repo can tailor reviews by adding a `.flue/` directory at its root —
the canonical Flue source location, so the same directory can hold overrides for
every fleet agent that reviews the repo, not just this one. Anything present is
layered on top of (or replaces) the central defaults according to
`override-mode`:

```
.flue/
  AGENTS.md            # this repo's conventions/standards (context the reviewer respects)
  prompts/*.md         # review priorities for this repo
  skills/<name>/SKILL.md   # extra review skills (or a code-review skill to replace the default)
  personas/*.md        # repo-specific reviewer personas for focused passes
```

> The reviewer's own persona lives in the central `code-review` skill. A repo's
> `AGENTS.md` (root or `.flue/`) describes *that* repo — the reviewer reads it
> for context and holds the PR to those standards.

- **`merge` (default):** central defaults apply first, then the repo's local
  files refine them (local wins on conflict).
- **`replace`:** when the repo ships local files of a given kind (e.g. prompts),
  only those are used and the central ones are ignored for that kind. In
  `replace`, a local `skills/code-review/SKILL.md` supersedes the default review
  methodology entirely.

If a repo ships no `.flue/`, it just gets the central defaults.

## How it works

The action runs in the consuming repo's CI. `github.action_path` is the
checked-out agents repo, so the agent's code, skills, and prompts come along for
free at the pinned ref. The action installs deps, then runs
`flue run pr-review`, passing the PR coordinates plus the paths to the central
config (`REVIEW_AGENT_DIR`) and the consumer's checkout (`REVIEW_TARGET_DIR`).
The `code-review` skill resolves the layered guidance, fetches the diff with
`gh`, reviews, and posts the result.

## Models

The agent runs on [GitHub Models](https://docs.github.com/en/github-models) by
default — `app.ts` registers it as a Flue provider (`github/*`,
OpenAI-chat-completions compatible). Three ways to run:

- **Default — `github/openai/gpt-4.1`.** Add `models: read` to `permissions`;
  the built-in `GITHUB_TOKEN` authenticates it (no API key). On a **free** plan
  GitHub caps requests at ~8k input tokens — too small for most real reviews
  (system prompt + skill + diff overflow it). A **paid** plan lifts that to
  production limits, which is what makes normal PRs fit. `github/openai/gpt-4o`
  works the same way.
- **gpt-5 family.** `github/openai/gpt-5` / `gpt-5-mini` are reasoning models
  that require the responses API / `max_completion_tokens`, which this provider
  doesn't wire up yet — they'll 400 through the chat-completions path. Not
  supported as-is.
- **Anthropic.** Set `model: anthropic/claude-sonnet-4-6` and pass
  `anthropic-api-key: ${{ secrets.ANTHROPIC_API_KEY }}`. Drop `models: read`.

Locally, set `GITHUB_MODELS_TOKEN` (a PAT with `models: read`) or
`REVIEW_MODEL` + `ANTHROPIC_API_KEY`.

> **Heads up on the free tier.** GitHub Models does **not** host Claude, and the
> *free* tier is rate-limited (~8000 input / 4000 output tokens per request,
> ~10–15 requests/min, ~50–150 requests/day). A review of a non-trivial PR makes
> several model calls and a large diff can exceed the per-request token cap, so
> big or busy repos will hit limits. Enable **paid** GitHub Models (lifts the cap
> for gpt-4.1/gpt-4o) or use Anthropic for real throughput.

## Alternative: reusable workflow

Prefer a reusable workflow over a composite action? Convert
`.github/workflows/pr-review.yml` to `on: workflow_call` with the same inputs;
consumers then use:

```yaml
jobs:
  review:
    uses: <owner>/agents/.github/workflows/pr-review.yml@main
    secrets: inherit
```
