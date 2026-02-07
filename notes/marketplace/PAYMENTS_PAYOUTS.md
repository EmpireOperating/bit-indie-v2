# Marketplace — Payments & Payouts (v1)

## Policy
- 10% platform fee.
- Final sale (no standard refunds/chargebacks).
- Payout per sale (processed asynchronously via worker).
- Developer payout destination: LN Address.

## Key design goals
- **Idempotency**: webhooks, retries, and worker restarts must never double-pay.
- **Ledger-backed truth**: state transitions write immutable ledger entries.

## Purchase flow
1) Client requests invoice creation for a game (entitles the whole game).
2) Backend creates provider invoice.
3) Persist `Purchase(status=PENDING)` + `LedgerEntry(INVOICE_CREATED)`.
4) Provider webhook confirms payment.
5) Backend verifies webhook authenticity, then:
   - set `Purchase(status=PAID, paid_at=...)`
   - create `Entitlement`
   - write `LedgerEntry(INVOICE_PAID)`
   - compute fee + net and write:
     - `LedgerEntry(PLATFORM_FEE)`
     - `LedgerEntry(DEVELOPER_NET)`
   - create `Payout(status=SCHEDULED)`

## Payout flow (worker)
- Worker picks `Payout(status=SCHEDULED|RETRYING)`.
- Sends payment to `destination_ln_address`.
- On success:
  - set `Payout(status=SENT, sent_at=...)`
  - write `LedgerEntry(PAYOUT_SENT)`
- On failure:
  - set `Payout(status=FAILED or RETRYING)` with backoff
  - write `LedgerEntry(PAYOUT_FAILED)`

## Idempotency keys
- Purchase invoice creation: idempotency key = `(buyer_id_or_guest_code, game_id, price_msat, day_bucket)`
- Webhook processing: idempotency key = `invoice_id`
- Payout send: idempotency key = `payout_id` (or provider-specific key)

## Guest purchases
- Create a `guest_receipt_code` at purchase creation.
- Receipt code can later be claimed into a user account.
- Webhook still finalizes entitlement against the purchase.

## Notes
- Provider choice (OpenNode) will define webhook format + payout API.
- We keep the interface generic so we can swap providers later.
