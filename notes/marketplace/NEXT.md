# NEXT (bit-indie-v2)

This file is the hand-off baton for automated work ticks.

## Active
- Add a context lookup SQL query variant **by payout id** (UUID):
  - return payout + purchase + game + buyer pubkey + guestReceiptCode
  - keep it copy/paste friendly.

## Done (this tick)
- Added a context lookup SQL query variant **by invoice id** (OpenNode invoice/charge id → `Purchase.invoiceId`) to the OpenNode payout confirmation runbook.

- Added a second context query variant for **guest purchases** (includes `guestReceiptCode`) to the OpenNode payout confirmation runbook.

- Added a context *join* SQL query (payout + purchase + game slug/title + buyer pubkey) to the OpenNode payout confirmation runbooks.
  - Commit (clawd): `75bcf54`
  - Commit (bit-indie-v2): `b2f5972`

- Added 3 copy/paste example entries (fake shas) to `notes/marketplace/staging-deploy-history.md` using the standardized note strings.

- Standardized deploy-history note strings and updated the staging deploy runbook + history format so entries are consistent:
  - `currently deployed (pre-change)`
  - `intended deploy (pre-compose up)`
  - `deployed (smoke checks OK)`

- Added a single copy/paste one-liner that logs the **intended** deploy sha (checked-out ref on the VPS; *before* `docker compose up`) into `notes/marketplace/staging-deploy-history.md`.

- Added a single copy/paste one-liner for **post-deploy** that fetches the *new* deployed short sha over SSH and appends it to `notes/marketplace/staging-deploy-history.md` with a sane default note.

- Added a single copy/paste one-liner that fetches the currently deployed short sha over SSH **and appends it to** `notes/marketplace/staging-deploy-history.md`.

- Added an SSH one-liner to print the currently deployed short sha (no interactive SSH session needed).
  - Commit (clawd): `fbd81db`

- Added copy/paste snippets to the staging deploy runbook for logging deploy history quickly.
  - Commits (clawd): `6903f69`, `17a7290`

- Clarified `staging-deploy-history.md` entry ordering (append-friendly).
  - Commit (clawd): `fe2ab09`

- Added a post-deploy “record new sha” step after smoke checks in the staging deploy runbook.
  - Commit (clawd): `4f24ac5`

- Added a tiny “verify checked-out ref” step right after `git checkout` (`git rev-parse --short HEAD`) + reminder to paste into `staging-deploy-history.md`.
  - Commit (clawd): `e040092`

- Added a `git status` / “working tree clean” sanity step (with what to do if it isn’t) before `git checkout <tag-or-sha>` in the staging deploy runbook.
  - Commit (clawd): `e83823a`

- Added “record currently deployed sha” as step (1) in the **update / redeploy** flow (right before `git checkout`) so it’s harder to skip.
  - Commit (clawd): `1c2eafc`

- Added a short “rollback + troubleshooting” section to the staging deploy runbook (rollback to previous sha, `docker compose ps/logs`, what to do if `prisma migrate deploy` fails).
  - Commit (clawd): `90b0272`

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
