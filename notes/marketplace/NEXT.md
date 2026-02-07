# NEXT (bit-indie-v2)

This file is the hand-off baton for automated work ticks.

## Active
- Apply the OpenNode payout confirmation changes in a real env:
  - run Prisma migration adding Payout.SUBMITTED + providerWithdrawalId fields
  - set OPENNODE_WITHDRAWAL_CALLBACK_URL to point at /webhooks/opennode/withdrawals
  - verify webhook marks payouts SENT only on status=confirmed
