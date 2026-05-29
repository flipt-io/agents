---
name: api-compatibility
description: Check a diff for breaking changes to this repo's public HTTP API and SDK surface, and require a versioning/migration note when one is found.
---

# API compatibility check (sample consumer skill)

An extra review skill this repo ships. In `merge` mode the reviewer applies it
in addition to the central methodology; it is meant to run as a focused pass
over diffs that touch the public surface.

## When to apply

Only when the diff changes files under `api/`, `openapi.yaml`, `proto/`, or the
published SDK (`packages/sdk/`). Skip otherwise.

## What counts as breaking

- Removing or renaming an endpoint, field, enum value, or query parameter.
- Tightening validation on an existing input (newly-required field, narrower
  type, stricter format).
- Changing a response shape, status code, or error code clients depend on.
- Changing default behavior of an existing parameter.

## What to require

For any breaking change, the review must:

1. Mark it `major` (or `critical` if it ships without a new API version).
2. Require one of: a new versioned route/namespace, a deprecation window, or an
   explicit `BREAKING CHANGE:` note in the PR description with a migration path.
3. Confirm the changelog/SDK release notes are updated in the same PR.

Additive, backwards-compatible changes (new optional field, new endpoint) are
fine — note them, don't block.
