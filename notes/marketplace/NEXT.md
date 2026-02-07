# NEXT (bit-indie-v2)

This file is the hand-off baton for automated work ticks.

## Active
- Actually apply the OpenNode payout confirmation changes in a real environment:
  - Run DB migration (`cd apps/api && pnpm prisma migrate deploy`)
  - Set `OPENNODE_WITHDRAWAL_CALLBACK_URL=https://<api-host>/webhooks/opennode/withdrawals`
  - Verify end-to-end: payout goes SUBMITTED on submit and only becomes SENT after webhook `status=confirmed`
  - Optional: simulate webhook:
    - `apps/api/scripts/opennode-withdrawal-webhook.mjs`
