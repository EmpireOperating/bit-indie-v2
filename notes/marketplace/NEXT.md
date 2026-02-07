# NEXT (bit-indie-v2)

This file is the hand-off baton for automated work ticks.

## Active (Fallback Active)
- Add an idempotency test for the OpenNode withdrawals webhook confirmed path:
  - if a `PAYOUT_SENT` ledger entry already exists, the webhook should not attempt to create a second one.
  - Safe slice: tests-only + local run.

## Done (this tick)
- Add a test for the OpenNode withdrawals webhook route:
  - when the payout is **not found**, it returns **200** (to avoid retries) and does **not** attempt updates/transactions.
  - Commit: `ca9550a`

## Blocked (operator-only)
- **BLOCKED (operator-needed deploy target):** finish verifying the OpenNode payout confirmation changes on a real environment.
  - Runbook: `/home/josh/clawd/notes/runs/marketplace/5671b86c-28d8-4e04-8c83-62a08c08d1da/summary.md`
  - Needs: API host + DB access + ability to set env vars.
  - Once a target is chosen, do:
    - `cd apps/api && pnpm prisma migrate deploy`
    - set `OPENNODE_WITHDRAWAL_CALLBACK_URL=https://<api-host>/webhooks/opennode/withdrawals`
    - verify: payout becomes `SUBMITTED` on submit, then `SENT` only after webhook `status=confirmed`
