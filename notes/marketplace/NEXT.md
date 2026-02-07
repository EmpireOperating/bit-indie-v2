# NEXT (bit-indie-v2)

This file is the hand-off baton for automated work ticks.

## Active
- Add a minimal payout worker (mock provider): process `Payout(status=SCHEDULED|RETRYING)` → mark `SENT` and write `LedgerEntry(PAYOUT_SENT)` idempotently.

## After
- Tighten entitlement gate once auth/session identity is wired in (don’t rely on query params).
