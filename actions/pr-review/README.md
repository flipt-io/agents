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
      - uses: <owner>/agents/actions/pr-review@main
        with:
          pr-number: ${{ github.event.pull_request.number }}
          anthropic-api-key: ${{ secrets.ANTHROPIC_API_KEY }}
```

Add `ANTHROPIC_API_KEY` as a repo secret. That's it — open a PR and the agent
reviews it.

- `@main` → always uses the latest central skills/prompts.
- `@v1` (a tag) → pins to a released version for reproducible reviews.

## Inputs

| Input               | Required | Default              | Description |
| ------------------- | -------- | -------------------- | ----------- |
| `pr-number`         | yes      | —                    | PR number to review. |
| `anthropic-api-key` | yes      | —                    | Model API key. |
| `repo`              | no       | current repo         | `owner/name` of the PR. |
| `model`             | no       | agent default        | Override the review model. |
| `override-mode`     | no       | `merge`              | `merge` or `replace` — how local overrides combine with defaults. |
| `github-token`      | no       | `github.token`       | Token for `gh` (needs `pull-requests: write`). |

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
