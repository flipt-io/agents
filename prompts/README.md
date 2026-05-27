# Global review prompts

Every `.md` file in this directory is **global guidance** — the `code-review`
skill reads all of them (in filename order) on every pull request. Nothing here
is per-PR; drop a file in and it applies to the next review automatically, no
code change required.

Use a numeric prefix to control ordering, e.g. `00-`, `10-`, `20-`.

Keep each file focused on *what the team cares about* in review (priorities,
conventions, things to always check). The reviewer's persona and standing rules
live in `skills/code-review/SKILL.md`; specialized lenses live in `personas/`.
This directory is for review **content/priorities**.
