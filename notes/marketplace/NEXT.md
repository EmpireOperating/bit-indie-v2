# NEXT (bit-indie-v2)

This file is the hand-off baton for automated work ticks.

## Active
- Strengthen payout idempotency at the DB level (unique constraint or explicit idempotency table for `LedgerEntry(PAYOUT_SENT)`).

## After
- Replace mock payout provider with a real LN Address payout integration (still idempotent + retry-safe).
