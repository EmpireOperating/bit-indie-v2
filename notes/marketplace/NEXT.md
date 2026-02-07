# NEXT (bit-indie-v2)

This file is the hand-off baton for automated work ticks.

## Active (Fallback Active)
- Update `apps/api/docs/opennode-withdrawals-webhook.md` to mention we persist `processed_at` + `fee` into `payout.providerMetaJson.webhook` for **all** webhook statuses (confirmed/failed/unknown) for auditability.
  - Safe slice: docs-only.

## Done (last tick)
- Persist more of the OpenNode withdrawals webhook payload (`processed_at`, `fee`) into `providerMetaJson.webhook` for **all** statuses (confirmed/failed/unknown) so we have better auditability.
  - Commit: `811bb34`

## Blocked (operator-only)
- **BLOCKED (operator-needed deploy target):** finish verifying the OpenNode payout confirmation changes on a real environment.
  - Runbook: `/home/josh/clawd/notes/runs/marketplace/5671b86c-28d8-4e04-8c83-62a08c08d1da/summary.md`
  - Needs: API host + DB access + ability to set env vars.
  - Once a target is chosen, do:
    - `cd apps/api && pnpm prisma migrate deploy`
    - set `OPENNODE_WITHDRAWAL_CALLBACK_URL=https://<api-host>/webhooks/opennode/withdrawals`
    - verify: payout becomes `SUBMITTED` on submit, then `SENT` only after webhook `status=confirmed`
