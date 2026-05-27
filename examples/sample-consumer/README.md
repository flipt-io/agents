# Sample consuming repo

This is what a repo that *uses* the PR review agent looks like. It is not part
of the agent project — copy the pieces you want into your own repo.

Two things make a repo a consumer:

1. **A workflow** that calls the action — see
   [`../consumer-workflow.yml`](../consumer-workflow.yml). Drop it in as
   `.github/workflows/pr-review.yml`.
2. **(Optional) a `.flue/` directory** of overrides — the `.flue/` here shows
   every override type. Ship only the parts you need; omit `.flue/` entirely to
   just use the central defaults.

## What the `.flue/` here demonstrates

```
.flue/
  AGENTS.md                      # THIS repo's conventions (context the reviewer respects)
  prompts/00-house-rules.md      # extra review priorities for THIS repo
  skills/api-compatibility/SKILL.md   # an extra review skill
  personas/performance.md        # a repo-specific persona for focused passes
```

The reviewer's own persona is central (in the agent's `code-review` skill). The
`AGENTS.md` here just tells the reviewer what *this* repo is and how it expects
code to be written — note it doubles as the standard file any coding agent reads
when working in the repo.

`.flue/` is the canonical Flue source directory, so the same folder holds
overrides for every fleet agent that reviews this repo — not just `pr-review`.

## merge vs replace

The action's `override-mode` input decides how this layers with the central
defaults:

- **`merge` (default):** central guidance applies, then the files here refine it
  (local wins on conflict). Use this to *add* repo-specific rules on top.
- **`replace`:** the files here take over for the kinds they define. A
  `.flue/skills/code-review/SKILL.md` here would replace the central review
  methodology entirely. Use this when a repo needs a fundamentally different
  review.
