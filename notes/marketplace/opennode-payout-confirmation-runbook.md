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
   - `npm ci`
   - `npm run prisma -- migrate deploy`

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

### Copy/paste SQL queries (Postgres)
Assumptions: Prisma default table names (`"Payout"`, `"LedgerEntry"`, `"Purchase"`, `"Game"`, `"User"`).

**Lookup payout by payout id** (`:payout_id` is a UUID):
```sql
select
  p."id",
  p."purchaseId",
  p."status",
  p."submittedAt",
  p."confirmedAt",
  p."providerWithdrawalId",
  p."providerMetaJson"->'webhook' as "webhookJson",
  p."updatedAt"
from "Payout" p
where p."id" = :payout_id;
```

**Lookup payout by purchase id** (`:purchase_id` is a UUID):
```sql
select
  p."id",
  p."purchaseId",
  p."status",
  p."submittedAt",
  p."confirmedAt",
  p."providerWithdrawalId",
  p."providerMetaJson"->'webhook' as "webhookJson",
  p."updatedAt"
from "Payout" p
where p."purchaseId" = :purchase_id;
```

**Lookup payout by withdrawal id** (`:withdrawal_id` is text):
```sql
select
  p."id",
  p."purchaseId",
  p."status",
  p."submittedAt",
  p."confirmedAt",
  p."providerWithdrawalId",
  p."providerMetaJson"->'webhook' as "webhookJson",
  p."updatedAt"
from "Payout" p
where p."providerWithdrawalId" = :withdrawal_id;
```

**Context lookup by invoice id** (`:invoice_id` is text; maps to `Purchase.invoiceId`):
```sql
select
  p."id" as "payoutId",
  p."status" as "payoutStatus",
  p."provider",
  p."providerWithdrawalId",
  p."submittedAt",
  p."confirmedAt",
  pu."id" as "purchaseId",
  pu."status" as "purchaseStatus",
  pu."invoiceProvider" as "invoiceProvider",
  pu."invoiceId" as "invoiceId",
  pu."amountMsat" as "purchaseAmountMsat",
  pu."paidAt" as "purchasePaidAt",
  pu."guestReceiptCode" as "guestReceiptCode",
  g."slug" as "gameSlug",
  g."title" as "gameTitle",
  u."pubkey" as "buyerPubkey"
from "Payout" p
join "Purchase" pu on pu."id" = p."purchaseId"
join "Game" g on g."id" = pu."gameId"
left join "User" u on u."id" = pu."buyerUserId"
where pu."invoiceId" = :invoice_id;
```

**Context join: payout + purchase + game (+ buyer pubkey)**

By payout id:
```sql
select
  p."id" as "payoutId",
  p."status" as "payoutStatus",
  p."provider",
  p."providerWithdrawalId",
  p."submittedAt",
  p."confirmedAt",
  pu."id" as "purchaseId",
  pu."status" as "purchaseStatus",
  pu."amountMsat" as "purchaseAmountMsat",
  pu."paidAt" as "purchasePaidAt",
  pu."guestReceiptCode" as "guestReceiptCode",
  g."slug" as "gameSlug",
  g."title" as "gameTitle",
  u."pubkey" as "buyerPubkey"
from "Payout" p
join "Purchase" pu on pu."id" = p."purchaseId"
join "Game" g on g."id" = pu."gameId"
left join "User" u on u."id" = pu."buyerUserId"
where p."id" = :payout_id;
```

By purchase id:
```sql
select
  p."id" as "payoutId",
  p."status" as "payoutStatus",
  p."provider",
  p."providerWithdrawalId",
  p."submittedAt",
  p."confirmedAt",
  pu."id" as "purchaseId",
  pu."status" as "purchaseStatus",
  pu."amountMsat" as "purchaseAmountMsat",
  pu."paidAt" as "purchasePaidAt",
  g."slug" as "gameSlug",
  g."title" as "gameTitle",
  u."pubkey" as "buyerPubkey"
from "Payout" p
join "Purchase" pu on pu."id" = p."purchaseId"
join "Game" g on g."id" = pu."gameId"
left join "User" u on u."id" = pu."buyerUserId"
where pu."id" = :purchase_id;
```

By provider withdrawal id:
```sql
select
  p."id" as "payoutId",
  p."status" as "payoutStatus",
  p."provider",
  p."providerWithdrawalId",
  p."submittedAt",
  p."confirmedAt",
  pu."id" as "purchaseId",
  pu."status" as "purchaseStatus",
  pu."amountMsat" as "purchaseAmountMsat",
  pu."paidAt" as "purchasePaidAt",
  g."slug" as "gameSlug",
  g."title" as "gameTitle",
  u."pubkey" as "buyerPubkey"
from "Payout" p
join "Purchase" pu on pu."id" = p."purchaseId"
join "Game" g on g."id" = pu."gameId"
left join "User" u on u."id" = pu."buyerUserId"
where p."providerWithdrawalId" = :withdrawal_id;
```

**Guest purchase context join (includes guestReceiptCode)**
Use this when you only have the guest receipt code (and `buyerPubkey` may be null).

By guest receipt code:
```sql
select
  p."id" as "payoutId",
  p."status" as "payoutStatus",
  p."provider",
  p."providerWithdrawalId",
  p."submittedAt",
  p."confirmedAt",
  pu."id" as "purchaseId",
  pu."status" as "purchaseStatus",
  pu."amountMsat" as "purchaseAmountMsat",
  pu."paidAt" as "purchasePaidAt",
  pu."guestReceiptCode" as "guestReceiptCode",
  g."slug" as "gameSlug",
  g."title" as "gameTitle",
  u."pubkey" as "buyerPubkey"
from "Payout" p
join "Purchase" pu on pu."id" = p."purchaseId"
join "Game" g on g."id" = pu."gameId"
left join "User" u on u."id" = pu."buyerUserId"
where pu."guestReceiptCode" = :guest_receipt_code;
```

**Ledger idempotency (should be exactly 1):**

By purchase id:
```sql
select count(*) as "payoutSentCount"
from "LedgerEntry" le
where le."purchaseId" = :purchase_id
  and le."type" = 'PAYOUT_SENT';
```

By payout id (join payout → purchase → ledger):
```sql
select count(le.*) as "payoutSentCount"
from "Payout" p
join "LedgerEntry" le on le."purchaseId" = p."purchaseId"
where p."id" = :payout_id
  and le."type" = 'PAYOUT_SENT';
```

#### Local simulation (optional)
If you need to validate the callback handler without waiting for OpenNode, you can simulate the form-encoded webhook.

Helper script:
- `apps/api/scripts/opennode-withdrawal-webhook.mjs`

Examples:
- Print expected `hashed_order`:
  - `OPENNODE_API_KEY=... node scripts/opennode-withdrawal-webhook.mjs hash <withdrawalId>`
- Print a ready-to-run curl:
  - `OPENNODE_API_KEY=... node scripts/opennode-withdrawal-webhook.mjs curl https://<api-host> <withdrawalId> confirmed`

### C) Failure path
If webhook sends `status=error|failed`:
- `payout.status = FAILED`
- `payout.lastError` set

## Troubleshooting
- Webhook 401: wrong `hashed_order` computation or wrong `OPENNODE_API_KEY`.
- Webhook 200 + "payout not found": payout missing `providerWithdrawalId` or provider mismatch.
- Unique index conflict on `providerWithdrawalId`: duplicate withdrawals being attached; inspect worker logs.
