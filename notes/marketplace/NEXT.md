# NEXT (bit-indie-v2)

This file is the hand-off baton for automated work ticks.

## Active
- **Operator-needed deploy/verification:** apply the OpenNode payout confirmation changes on a real environment (needs API host + DB + env access).
  - Runbook written by Night Shift tick:
    - `/home/josh/clawd/notes/runs/marketplace/5671b86c-28d8-4e04-8c83-62a08c08d1da/summary.md`
  - Once the target is known, do:
    - `cd apps/api && pnpm prisma migrate deploy`
    - set `OPENNODE_WITHDRAWAL_CALLBACK_URL=https://<api-host>/webhooks/opennode/withdrawals`
    - verify: payout becomes `SUBMITTED` on submit, then `SENT` only after webhook `status=confirmed`
