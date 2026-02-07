# NEXT (bit-indie-v2)

This file is the hand-off baton for automated work ticks.

## Active
- Wire the new payout worker into a real runner (cron/systemd/k8s): `apps/api npm run payout:work`, and add basic guardrails (single-instance lock + metrics/log line).

## After
- Strengthen payout idempotency at the DB level (unique constraint or explicit idempotency table for `LedgerEntry(PAYOUT_SENT)`).
