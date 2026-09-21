# Paseo Hub: a self-hosted Hub cannot register GitHub repositories

Report for [getpaseo/hub](https://github.com/getpaseo/hub). Written 2026-09-21 against
Hub `0.9.0`, image digest
`sha256:ea8ba9be1f4ec51ff68683b17d4a3a21e2199ccf22014f5adac8057c9d1167b0`, source commit
`80672f200ca9f30da7e0b7832b1dffda55ca5502`. `latest` resolves to the same digest, so
there is no newer image to move to.

## What happens

On a fresh self-hosted Hub, the GitHub App connects, the dashboard shows the connection,
and webhooks arrive. Nothing can be deployed against that repository.

`paseo hub deploy --project default --dry-run`:

```
.paseo/workflows/change-review.yml: filters.repo: "owner/repo" does not match any GitHub repository (connected: none)
```

`paseo hub init`:

```
No Hub app connection is ready for this trigger.
Connect GitHub, Slack, or Discord in Hub → Apps, then run `paseo hub init` again.
```

Both messages point at the App install. The App is installed and working: the activity
page lists deliveries from the repository, dropped with `No project route is configured
for this event.`

## Why

The `github_repositories` table is empty and nothing can fill it.

`src/projects/dashboard.ts:189` `availableGitHubRepositories` is the only code that
writes the table. It calls `listInstallationRepositories` (`:198`) and upserts the result
(`:201`).

It is a `ProjectRouteScope` route, called from `src/projects/configuration/panel.tsx`.
No route imports that panel. The dashboard serves `/o/$organizationSlug/` with
`activity`, `connections`, `daemons`, `settings` and `triggers`. There is no project
route, so the function never runs.

Everything downstream reads that table:

- `src/configuration/store.ts:736` resolves `filters.repo` against
  `listGitHubRepositories`, and returns `undefined` when the row is missing.
- `src/configuration/store.ts:649` then reports the error above.
- `:790` prints `connected: none`, because `formatResourceCandidates` (`:831`) reads the
  same empty table.
- In the CLI, `availableStarterTriggerConnections` keeps a GitHub connection only when
  `connection.repositories.includes(githubRepository)`, which is why `init` says no
  connection is ready.

Webhooks arrive because GitHub posts to `/webhook` whatever Hub has stored, and the
payload carries the repository name. Delivery does not depend on the table. Routing does.

## Steps to reproduce

1. Self-host Hub `0.9.0` with the embedded PGlite store.
2. Connect a GitHub App under **Apps → GitHub** and install it on a repository.
3. Confirm deliveries appear on the activity page.
4. Run `paseo hub init` from a clone of that repository.

Expected: the repository is offered as a trigger target.
Actual: `No Hub app connection is ready for this trigger.`

## Expected behaviour

Installing the App should register its repositories. The lifecycle handler for
`installation` and `installation_repositories` in `src/providers/github/index.ts` already
receives the events that would justify it, and today updates only the binding.

Failing that, the org-level connections page should expose what the removed project panel
did, so `availableGitHubRepositories` has a caller again.

## Impact

A self-hosted Hub cannot create a GitHub trigger at all. Both the organization-trigger
path and the legacy project bundle are blocked by the same missing rows, so there is no
supported way around it.
