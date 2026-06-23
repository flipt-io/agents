---
# agents-krkk
title: Docker fast-path for the pr-review composite action
status: todo
type: feature
priority: low
tags:
    - pr-review
    - ci
    - performance
created_at: 2026-05-27T21:16:57Z
updated_at: 2026-05-27T21:16:57Z
---

## Problem

The `actions/pr-review` composite action runs `pnpm install --frozen-lockfile`
on every invocation in the consuming repo's runner. As the agent's dependency
tree grows, this adds latency (and flakiness) to every PR review.

## Proposed solution

Offer a Docker-based variant of the action with dependencies (and ideally a
prebuilt `flue build` artifact) baked into the image:

- Add a `Dockerfile` that installs deps and runs `flue build`, publishing to
  GHCR (e.g. `ghcr.io/<owner>/pr-review:<tag>`), tagged per release.
- Add a Docker `runs:` variant (`using: docker`, `image: docker://ghcr.io/...`)
  or a second action (`actions/pr-review-docker/action.yml`) so consumers can
  choose composite (always-latest, slower) vs Docker (pinned, fast start).
- Pass the same inputs/env (`pr-number`, `anthropic-api-key`, `REVIEW_*`).

## Tradeoffs / open questions

- Baked image = skills/prompts frozen at build time -> reproducible reviews, but
  "always-latest" no longer applies to the Docker variant. Decide whether it
  still pulls central config at runtime or ships it baked.
- Per-repo `.flue/` overrides still read from the consumer checkout at runtime,
  so they are unaffected.
- Image build/publish pipeline + version/tag strategy.

## Acceptance

- A consumer can switch to the Docker variant and see review jobs start without
  a dependency install step.
- Docs in `actions/pr-review/README.md` explain composite vs Docker tradeoffs.

Deferred from the initial build-out (2026-05-27) at the user's request.
