# OpenNode withdrawals webhook (local verification)

This API exposes:

- `POST /webhooks/opennode/withdrawals`

OpenNode delivers `application/x-www-form-urlencoded`.

## What the server expects

Fields we currently use:
- `id` (withdrawal id)
- `status` (`confirmed` | `failed` | `error` | other)
- `hashed_order`

`hashed_order` must equal:

```
HMAC_SHA256_HEX(OPENNODE_API_KEY, <withdrawalId>)
```

If the signature is invalid, the server returns **401**.

If the payout cannot be found for the given provider withdrawal id, the server returns **200** (to avoid infinite retries).

## Status handling

For auditability, we persist a webhook receipt under `payout.providerMetaJson.webhook` **for all statuses**, including `processed_at` + `fee` when present.

- `confirmed`:
  - payout status becomes `SENT`
  - `confirmedAt` is set
  - a **deduped** ledger entry `PAYOUT_SENT` is written (dedupe key: `payout_sent:<purchaseId>`)
  - webhook receipt recorded under `providerMetaJson.webhook`

- `failed` / `error`:
  - payout status becomes `FAILED`
  - `lastError` set
  - webhook receipt recorded under `providerMetaJson.webhook`

- anything else:
  - payout status remains `SUBMITTED`
  - webhook receipt recorded under `providerMetaJson.webhook`

## Quick helper script

From `apps/api/`:

```bash
OPENNODE_API_KEY=... \
  node scripts/opennode-withdrawal-webhook.mjs hash <withdrawalId>

OPENNODE_API_KEY=... \
  node scripts/opennode-withdrawal-webhook.mjs curl \
  http://127.0.0.1:8787 <withdrawalId> confirmed

# Or actually POST it (useful for headless verification)
OPENNODE_API_KEY=... \
  node scripts/opennode-withdrawal-webhook.mjs post \
  http://127.0.0.1:8787 <withdrawalId> confirmed
```

The `curl` command prints a ready-to-run curl snippet that includes the correct `hashed_order`.

Optional fields supported by the helper:
- `--processed-at <iso>`
- `--fee <value>`
- `--error <message>` (used for `failed|error`)

Example (failed):

```bash
OPENNODE_API_KEY=... node scripts/opennode-withdrawal-webhook.mjs curl \
  https://<api-host> <withdrawalId> failed \
  --error "insufficient funds" \
  --processed-at "2026-02-07T15:12:00Z"
```
