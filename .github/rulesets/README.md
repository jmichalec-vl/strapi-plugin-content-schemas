# Repository rulesets

Source of truth for the GitHub rulesets protecting this repository. Apply or
update them with the GitHub CLI (replace `<owner>/<repo>`):

```bash
gh api -X POST repos/<owner>/<repo>/rulesets --input .github/rulesets/main-branch.json
gh api -X POST repos/<owner>/<repo>/rulesets --input .github/rulesets/release-tags.json
```

To update an existing ruleset, find its id with
`gh api repos/<owner>/<repo>/rulesets` and use `-X PUT .../rulesets/<id>`.

## What they enforce

- `main-branch`: no deletion or force-push, linear history, pull requests with
  one approving review, all four CI jobs green on an up-to-date branch.
- `release-tags`: `v*` tags cannot be created, moved or deleted by hand.

## Bypass actors

- `RepositoryRole 5` (Admin): the maintainer can merge their own pull requests
  and recover from mistakes.
- `Integration 15368` (GitHub Actions): the publish workflow pushes the
  version commit and tag to `main` with the built-in `GITHUB_TOKEN`, so no
  personal access token is stored as a secret.

## Also enable in Settings > Code security

Secret scanning with push protection, Dependabot alerts and security updates,
and CodeQL default setup. `.github/dependabot.yml` keeps npm dependencies and
action versions current.
