# OpenNode payout confirmation — preflight (bit-indie-v2)

Purpose: quick, safe checks you can do **before** touching a real environment.

This is intended to reduce “oops wrong env / missing env var / wrong webhook URL” mistakes.

## 0) Confirm code is present (local)
From repo root:

- Webhook route exists:
  - `apps/api/src/routes/opennodeWebhooks.ts` includes `POST /webhooks/opennode/withdrawals`
- Worker uses callback URL env var:
  - `OPENNODE_WITHDRAWAL_CALLBACK_URL`
- Prisma migration exists:
  - `apps/api/prisma/migrations/202602071325_opennode_payout_webhook/`

## 1) Deployment preconditions (collect, don’t execute)
You need answers for:

- Target environment: `staging` or `prod`
- API base URL (public): `https://<api-host>`
- Where Prisma deploy is run (deploy host / CI job / manual)
- DB access method for that environment
- Confirm `OPENNODE_API_KEY` is set on the API service (do **not** paste it)

## 2) DB sanity SQL (optional, for when you have DB read access)
Postgres checks:

```sql
-- enum values
SELECT enumlabel
FROM pg_enum e
JOIN pg_type t ON t.oid = e.enumtypid
WHERE t.typname = 'PayoutStatus'
ORDER BY enumsortorder;

-- payout columns
SELECT column_name, data_type, is_nullable
FROM information_schema.columns
WHERE table_name = 'Payout'
ORDER BY ordinal_position;

-- verify providerWithdrawalId uniqueness if present
SELECT indexname, indexdef
FROM pg_indexes
WHERE tablename = 'Payout'
ORDER BY indexname;
```

## 3) Webhook URL + hashing notes
- Callback URL must be:
  - `OPENNODE_WITHDRAWAL_CALLBACK_URL=https://<api-host>/webhooks/opennode/withdrawals`
- Handler validates:
  - `hashed_order = HMAC_SHA256(OPENNODE_API_KEY, withdrawalId)`

If you need to validate hashing on a machine with access to `OPENNODE_API_KEY` (without printing it), do it in-process in the API runtime (preferred) rather than ad-hoc shell commands.

## 4) After deploy: what to watch in logs
Look for:
- Withdrawal submission -> `payout.status` becomes `SUBMITTED`
- Webhook received -> status transitions:
  - `confirmed` -> `SENT`
  - `error|failed` -> `FAILED`
- Idempotency: repeated webhook calls don’t create extra `PAYOUT_SENT` ledger entries.

(Then follow the main runbook: `notes/marketplace/opennode-payout-confirmation-runbook.md`.)
