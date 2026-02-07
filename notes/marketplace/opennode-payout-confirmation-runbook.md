# OpenNode payout confirmation — runbook (bit-indie-v2)

Goal: ensure payouts only become `SENT` after OpenNode confirms the withdrawal via webhook.

This repo already includes:
- Prisma migration: `apps/api/prisma/migrations/202602071325_opennode_payout_webhook/`
- Webhook route: `POST /webhooks/opennode/withdrawals` (`apps/api/src/routes/opennodeWebhooks.ts`)
- Worker behavior: payout submit → set `SUBMITTED` and persist `providerWithdrawalId` (`apps/api/src/workers/payoutWorker.ts`)

## Preconditions
- You have DB access for the target environment (staging/prod).
- You can set env vars for the API service.
- You can see API logs.

## Step 1 — Apply DB migration
From a machine with access to the DB + repo:

1) Ensure correct DATABASE_URL is set for the target env.
2) Run Prisma deploy:
   - `cd apps/api`
   - `pnpm prisma migrate deploy`

Expected: migration `202602071325_opennode_payout_webhook` is applied.

Sanity checks (optional):
- `PayoutStatus` enum includes `SUBMITTED`.
- `Payout` table has:
  - `provider` (nullable)
  - `providerWithdrawalId` (nullable, unique)
  - `providerMetaJson` (nullable)
  - `submittedAt` (nullable)
  - `confirmedAt` (nullable)

## Step 2 — Set callback URL
Set:
- `OPENNODE_WITHDRAWAL_CALLBACK_URL=https://<your-api-host>/webhooks/opennode/withdrawals`

Notes:
- The webhook handler validates `hashed_order` as `HMAC_SHA256(OPENNODE_API_KEY, withdrawalId)`.
- If `OPENNODE_API_KEY` is missing, webhooks are rejected (500).

## Step 3 — Verify behavior end-to-end
### A) Submit a payout
Trigger a payout in the app.

Expected DB state shortly after submission:
- `payout.status = SUBMITTED`
- `payout.provider = 'opennode'`
- `payout.providerWithdrawalId` is set
- `payout.submittedAt` is set

### B) Webhook confirmation
When OpenNode sends a webhook with `status=confirmed`:

Expected DB state:
- `payout.status = SENT`
- `payout.confirmedAt` is set
- `payout.lastError` cleared

Expected ledger:
- a single `LedgerEntry` with:
  - `type = 'PAYOUT_SENT'`
  - `dedupeKey = payout_sent:<purchaseId>`

### C) Failure path
If webhook sends `status=error|failed`:
- `payout.status = FAILED`
- `payout.lastError` set

## Troubleshooting
- Webhook 401: wrong `hashed_order` computation or wrong `OPENNODE_API_KEY`.
- Webhook 200 + "payout not found": payout missing `providerWithdrawalId` or provider mismatch.
- Unique index conflict on `providerWithdrawalId`: duplicate withdrawals being attached; inspect worker logs.
