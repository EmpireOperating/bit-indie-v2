# NEXT (bit-indie-v2)

This file is the hand-off baton for automated work ticks.

## Active
- Add a short “rollback + troubleshooting” section to the staging deploy runbook (`/home/josh/clawd/notes/marketplace/staging-deploy-runbook.md`):
  - how to roll back to the previous known-good sha
  - quick commands for `docker compose ps` / `logs -f api`
  - what to do if `migrate deploy` fails

## Done (this tick)
- Added an “update / redeploy (existing server)” section to `/home/josh/clawd/notes/marketplace/staging-deploy-runbook.md` (checkout new sha/tag, rebuild/restart compose, `prisma migrate deploy`, smoke checks).
  - Commit (clawd): `694d570`

- Added a “server layout + reproducible checkout” step to the staging deploy runbook (clone path + exact `git clone`/`git checkout`).
- Extended `notes/marketplace/staging-deploy-runbook.md` with copy/paste snippets for:
  - `/opt/bitindie-staging/compose.yml` (api+postgres+minio)
  - minimal Caddyfile block for `staging.bitindie.io`

- Linked the staging deploy runbook from `apps/api/README.md` and repo `DEV.md` so operators can find it quickly.

- Drafted `notes/marketplace/staging-deploy-runbook.md` (npm ci, build, migrate deploy, env vars, smoke checks, rollback).
- Added it to the runbooks index (`/home/josh/clawd/notes/marketplace/RUNBOOKS.md`).

- Added `RUNBOOKS.md` index and linked it from `notes/marketplace/README.md`.

- Docs/ops: added `OPENNODE_WITHDRAWAL_CALLBACK_URL` mentions + staging compose default.
  - Commits:
    - `c58deca` docs: mention callback URL env var in `apps/api/README.md`
    - `827915f` docs: add callback URL env var to `DEV.md`
    - `87c3f3f` chore: set callback URL in `apps/api/docker-compose.staging.yml`
  - Verified: `cd apps/api && npm test` (vitest) passes.

- Docs: OpenNode withdrawals webhook operator notes (callback URL + persisted fields) + `.env.example` improvements.
  - Commits:
    - `e53816a` docs: add callback URL config + persisted fields
    - `5fe2d69` env: add `OPENNODE_WITHDRAWAL_CALLBACK_URL` to `.env.example`
    - `a986d2d` env: fix malformed `DATABASE_URL` in `.env.example`

- Decision: YES — persist `providerMetaJson.webhook` even when payout is already `SENT` (confirmed webhook retries).
  - Implemented behavior-neutral update (no status/confirmedAt changes) + added unit test.
  - Commit: `51c4dcb`

## Blocked (operator-only)
- **BLOCKED (operator-needed deploy target):** finish verifying the OpenNode payout confirmation changes on a real environment.
  - Runbook: `notes/marketplace/opennode-payout-confirmation-runbook.md`
  - Needs: API host + DB access + ability to set env vars.
  - Once a target is chosen, do:
    - `cd apps/api && npm ci`
    - `npm run prisma -- migrate deploy`
    - set `OPENNODE_WITHDRAWAL_CALLBACK_URL=https://<api-host>/webhooks/opennode/withdrawals`
    - verify: payout becomes `SUBMITTED` on submit, then `SENT` only after webhook `status=confirmed`
