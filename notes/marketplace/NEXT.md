# NEXT (bit-indie-v2)

This file is the hand-off baton for automated work ticks.

## Active (Fallback Active)
- Add short operator-facing docs for OpenNode withdrawals webhook behavior (idempotency + audit metadata):
  - Where to set `OPENNODE_WITHDRAWAL_CALLBACK_URL`
  - Expected payload fields we persist (`processed_at`, `fee`, `status`, `error`)
  - Note: webhook retries are expected; we persist meta even if payout already `SENT`.
  - Safe slice: a small `apps/api/docs/opennode-withdrawals-webhook.md` + link from existing README/docs index.

## Done (this tick)
- Decision: YES — persist `providerMetaJson.webhook` even when payout is already `SENT` (confirmed webhook retries).
  - Implemented behavior-neutral update (no status/confirmedAt changes) + added unit test.
  - Commit: `51c4dcb`

## Blocked (operator-only)
- **BLOCKED (operator-needed deploy target):** finish verifying the OpenNode payout confirmation changes on a real environment.
  - Runbook: `/home/josh/clawd/notes/runs/marketplace/5671b86c-28d8-4e04-8c83-62a08c08d1da/summary.md`
  - Needs: API host + DB access + ability to set env vars.
  - Once a target is chosen, do:
    - `cd apps/api && npm run prisma migrate deploy`
    - set `OPENNODE_WITHDRAWAL_CALLBACK_URL=https://<api-host>/webhooks/opennode/withdrawals`
    - verify: payout becomes `SUBMITTED` on submit, then `SENT` only after webhook `status=confirmed`
