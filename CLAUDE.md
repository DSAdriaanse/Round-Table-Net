# Rules for Claude in this repository

## Branches

- `dev` is the integration branch. Claude may only pull or merge into `dev`: branch off `dev`, open pull requests whose base is `dev`, and nothing else.
- `main` is David's. Only David authorizes a merge from `dev` into `main`, and he does it himself on GitHub. Claude never merges into `main`, pushes to `main`, opens or updates a pull request whose base is `main`, or changes `main` in any other way.
- Claude never merges pull requests (into `dev` either), deletes branches, force-pushes, or rewrites history on `dev` or `main`.
- Merging `dev` into `main` on GitHub leaves `main` a merge commit ahead of `dev`. When `git rev-list --count origin/dev..origin/main` is above 0, Claude says so at the start of the work and brings `main` into `dev` the other way: a branch off `dev`, `git merge origin/main`, a pull request into `dev`. Claude resolves the conflicts on that branch, so David never has to.
- Before opening any pull request, Claude merges the latest `origin/dev` into its branch and fixes conflicts there. A pull request that shows conflicts is not finished.
- Work in small pull requests. Each description says what changed, how it was checked, and what could not be checked.

## Data and honesty

- Never commit real credentials, exports or personal data (callsigns, names, emails, PINs). Test data is made up.
- Do not claim something works unless it was run. Say what was only tested with stubs.
