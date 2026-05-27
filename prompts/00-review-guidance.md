# Review priorities

Apply these to every pull request, in order of importance.

## 1. Correctness

- Does the change do what the PR description says it does?
- Off-by-one errors, null/undefined handling, incorrect conditionals.
- Edge cases: empty inputs, large inputs, concurrent access, error paths.
- Does error handling fail loudly, or does it silently swallow problems?

## 2. Security

- Untrusted input reaching queries, shells, file paths, or templates.
- AuthN/AuthZ: is every new endpoint/action checking permissions?
- Secrets, tokens, or PII in code, logs, or fixtures.

## 3. Maintainability

- Names that say what they mean; functions that do one thing.
- Duplicated logic that should be shared; abstractions that aren't earning
  their keep.
- Tests for the new behavior, especially the edge cases above.

## What NOT to comment on

- Formatting, import order, or anything a linter/formatter owns.
- Personal style preferences that don't affect correctness or clarity.
- Pre-existing issues unrelated to this diff (note them once, don't block).
