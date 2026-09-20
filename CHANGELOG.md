# Changelog

Both composite actions — `actions/pr-review` and `actions/issue-health` — share
one repo-level version. They also share `app.ts`, `lib/`, the skills, and the
Flue runtime, so they ship together. See
[Versioning](README.md#versioning) for how to pin them.

This project follows [semantic versioning](https://semver.org/), where the
public surface is the actions' inputs and the environment they expect —
including which model providers and credentials a consumer has to supply.

## 1.0.0 (unreleased)

The version in `package.json` is the source of truth: bump it, move this
heading's `(unreleased)` marker off, then tag `v1.0.0`. The release workflow
refuses a tag that doesn't match `package.json`.

### Breaking

- **GitHub Models support is removed, and `model` is now a required input** on
  both actions. GitHub is discontinuing GitHub Models, so there is no longer a
  default model or a default provider: every caller names a provider-qualified
  model (e.g. `cloudflare-workers-ai/@cf/moonshotai/kimi-k2.6` or
  `anthropic/claude-sonnet-4-6`) and supplies that provider's credentials
  through `env:` on the calling step.

  To migrate, add `model:` to the `uses:` step, pass the provider credentials
  via `env:`, and drop `models: read` from the workflow's `permissions:`:

  ```yaml
  permissions:
    contents: read
    pull-requests: write
  # ...
    - uses: flipt-io/agents/actions/pr-review@v1
      env:
        CLOUDFLARE_API_KEY: ${{ secrets.CLOUDFLARE_API_KEY }}
        CLOUDFLARE_ACCOUNT_ID: ${{ secrets.CLOUDFLARE_ACCOUNT_ID }}
      with:
        pr-number: ${{ github.event.pull_request.number }}
        model: cloudflare-workers-ai/@cf/moonshotai/kimi-k2.6
  ```

  A missing or unqualified `model` now fails the action before it installs
  anything, and a missing `REVIEW_MODEL` / `ISSUE_HEALTH_MODEL` fails a local
  run at startup rather than part-way through.

  The `github/*` provider registration is gone from `app.ts`. Providers in
  pi-ai's catalog (`cloudflare-workers-ai/*`, `anthropic/*`, …) need no
  registration; anything else can be registered there.

### Added

- Tagged releases. `Release` (`.github/workflows/release.yml`) validates a
  `v*.*.*` tag, moves the `v1` alias, and publishes the GitHub release.
