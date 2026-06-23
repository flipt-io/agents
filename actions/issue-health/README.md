# Issue Health Check — composite action

Comment on newly opened issues with an actionability check, missing-information
checklist when needed, support links, and optional labels that already exist in
the target repository.

The model only returns structured analysis. The workflow code fetches the issue,
renders the comment, and applies labels deterministically.

## Use it in another repo

Add `.github/workflows/issue-health.yml` (see [`examples/issue-health-workflow.yml`](../../examples/issue-health-workflow.yml)):

```yaml
name: Issue Health Check

on:
  issues:
    types: [opened]

permissions:
  contents: read
  issues: write
  models: read            # default model is github/openai/gpt-4.1

jobs:
  issue-health:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4 # lets the agent read this repo's .agents/ overrides
      - uses: flipt-io/agents/actions/issue-health@main
        with:
          issue-number: ${{ github.event.issue.number }}
```

The defaults post one combined health-check/support comment and apply matching
labels only when those labels already exist in the target repository. The action
never creates labels, edits issue bodies, closes issues, assigns people, or
responds to issue edits/reopens in v1.

## Inputs

| Input | Required | Default | Description |
| --- | --- | --- | --- |
| `issue-number` | yes | — | Issue number to analyze. |
| `repo` | no | current repo | `owner/name` of the issue. |
| `model` | no | `github/openai/gpt-4.1` | Override the issue-health model. |
| `override-mode` | no | `merge` | `merge` or `replace` — how local `.agents/` overrides combine with defaults. |
| `local-config-dir` | no | `.agents` | Path in the target repo to `.agents`-compatible local overrides. Use workflow-specific directories like `.agents/issue-health` to keep multiple agents isolated. |
| `github-token` | no | `github.token` | Token for `gh` and GitHub Models. Needs `issues: write`; the default GitHub model also needs `models: read`. |
| `comment-mode` | no | `always` | `always`, `needs-improvement`, or `off`. |
| `label-mode` | no | `existing-only` | `existing-only` or `off`. `existing-only` filters suggestions against labels already present in the target repo. |

Provider credentials (`ANTHROPIC_API_KEY`, `CLOUDFLARE_API_KEY`,
`CLOUDFLARE_ACCOUNT_ID`, …) are read from the workflow environment — pass them
via `env:` on the `uses:` step or at the job level rather than as action inputs.

## Per-repo overrides (`.agents/`)

A consuming repo can tailor the issue-health analysis by adding an `.agents/`
directory at its root. The action passes the selected local override directory
to the workflow via `ISSUE_HEALTH_TARGET_DIR` plus `ISSUE_HEALTH_LOCAL_CONFIG_DIR`,
and `override-mode` controls how those files combine with central defaults:

- `merge` (default): central defaults apply first, then local files refine them.
- `replace`: local files replace central files for the kinds the repo provides.

When multiple fleet agents run in the same repo, keep their overrides isolated by
putting them in workflow-specific directories and setting `local-config-dir`:

```yaml
- uses: flipt-io/agents/actions/issue-health@main
  with:
    issue-number: ${{ github.event.issue.number }}
    local-config-dir: .agents/issue-health
```

The directory still uses the same shape (`prompts/`, `skills/`, `personas/`) as
`.agents/`.

## How it works

The composite action resolves this agents repo, installs dependencies, and runs:

```bash
pnpm exec flue run issue-health --payload '{"issueNumber": 123, "repo": "owner/name"}'
```

It sets the `ISSUE_HEALTH_*` environment variables consumed by
`workflows/issue-health.ts`:

- `ISSUE_HEALTH_AGENT_DIR`
- `ISSUE_HEALTH_TARGET_DIR`
- `ISSUE_HEALTH_LOCAL_CONFIG_DIR`
- `ISSUE_HEALTH_OVERRIDE_MODE`
- `ISSUE_HEALTH_MODEL`
- `ISSUE_HEALTH_COMMENT_MODE`
- `ISSUE_HEALTH_LABEL_MODE`

GitHub IO is deterministic workflow code. The issue-health skill receives issue
context and target-repo label names, returns structured analysis, and cannot
post comments or apply labels on its own.

## Models

The default model is `github/openai/gpt-4.1` via GitHub Models, authenticated by
the built-in token when `models: read` is granted.

To use Anthropic or Cloudflare Workers AI, pass provider credentials with `env:`
and set `model`; drop `models: read` if you are not using a `github/*` model.

```yaml
- uses: flipt-io/agents/actions/issue-health@main
  env:
    ANTHROPIC_API_KEY: ${{ secrets.ANTHROPIC_API_KEY }}
  with:
    issue-number: ${{ github.event.issue.number }}
    model: anthropic/claude-sonnet-4-6
```
