# NEXT (bit-indie-v2)

This file is the hand-off baton for automated work ticks.

## Active (Fallback Active)
- Add headless-friendly local verification docs for the OpenNode withdrawals webhook + tighten the helper script usage.
  - Done: commit `fae3ec2` (apps/api docs + script flags)
  - Docs: `apps/api/docs/opennode-withdrawals-webhook.md`

## Blocked (operator-only)
- **BLOCKED (operator-needed deploy target):** finish verifying the OpenNode payout confirmation changes on a real environment.
  - Runbook: `/home/josh/clawd/notes/runs/marketplace/5671b86c-28d8-4e04-8c83-62a08c08d1da/summary.md`
  - Needs: API host + DB access + ability to set env vars.
  - Once a target is chosen, do:
    - `cd apps/api && pnpm prisma migrate deploy`
    - set `OPENNODE_WITHDRAWAL_CALLBACK_URL=https://<api-host>/webhooks/opennode/withdrawals`
    - verify: payout becomes `SUBMITTED` on submit, then `SENT` only after webhook `status=confirmed`
