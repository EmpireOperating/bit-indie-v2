# NEXT (bit-indie-v2)

This file is the hand-off baton for automated work ticks.

## Active
- Draft a minimal `notes/marketplace/staging-deploy-runbook.md` for `apps/api` (npm ci, migrate deploy, required env vars, smoke checks).

## Done (this tick)
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
