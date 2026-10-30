# Repository contribution instructions

## `main` is frozen until 2027-01-11

- From 2026-10-30 17:00 UTC until the winners are announced on 2027-01-11, don't commit or push to `main` (D-39 in `docs/nebius-hackathon-plan.md`). All work goes to the `ops` branch.
- The one exception is a hotfix without which the judges can't test the app: only with @Maximal1337's OK, as a commit of its own, the way `deploy/README.md` describes ("A hotfix during the freeze").
- CI runs on pushes to `main` and on pull requests, not on pushes to `ops`. For CI on `ops`, open a draft pull request into `main`; it isn't merged before 2027-01-11.

## Pull request messages

- Keep pull request titles and descriptions limited to the repository changes and their verification.
- Do not include links or references to task conversations, generated work sessions, assistants, models, or vendors.
- Write pull request messages as ordinary engineering documentation, without process metadata or promotional attribution.

## Commit messages

- Commits by @Maximal1337 carry no `Co-Authored-By` trailers and no other attribution to assistants, models or vendors.
- Other contributors' commits may keep their `Co-Authored-By` trailers.
