# marketplace-api

See also:
- `../../DEV.md` (repo handoff + dev guide)

Local dev:

1) Start infra:
```bash
cd ../../infra
docker compose up -d
```

2) Configure env:
```bash
cd ../apps/api
cp .env.example .env
```

If you are using the OpenNode withdrawals webhook flow, set:
- `OPENNODE_WITHDRAWAL_CALLBACK_URL=http://127.0.0.1:8787/webhooks/opennode/withdrawals`
  - Docs: `./docs/opennode-withdrawals-webhook.md`

3) Run migrations:
```bash
npm run db:migrate
```

4) Start API:
```bash
npm run dev
```

Health check:
- http://127.0.0.1:8787/health

Payout readiness (config visibility):
- http://127.0.0.1:8787/ops/payouts/readiness
- callback URL validation requires `http://` or `https://` protocol
- when `OPENNODE_BASE_URL` is set, readiness also validates it uses `http://` or `https://`

OpenNode webhook verification (local/dev):
- Docs: `./docs/opennode-withdrawals-webhook.md`
- Helper:
  - `OPENNODE_API_KEY=... node scripts/opennode-withdrawal-webhook.mjs hash <withdrawalId>`
  - `OPENNODE_API_KEY=... node scripts/opennode-withdrawal-webhook.mjs curl http://127.0.0.1:8787 <withdrawalId> confirmed`
- Payload requirements: include `id`, `status`, and `hashed_order`.
  - `hashed_order` accepts either raw hex digest or `sha256=<hex>` format.
- Webhook `status` is trimmed and lowercased server-side before state handling; metadata includes `status_raw`, `status_known`, `status_kind`, and `status_had_surrounding_whitespace` for non-blocking provider-status drift triage.
- Webhook `processed_at` is trimmed for storage; audit metadata includes `processed_at_iso` and `processed_at_valid` without rejecting legacy payloads.
- Webhook timing telemetry (`processed_at_age_seconds`, `processed_at_in_future`, `processed_at_older_than_30d`) is additive and used only for skew/staleness observability.
- Webhook `error` is trimmed, capped at 500 chars, and annotated with `error_truncated` in audit metadata.
- Webhook status/error consistency telemetry (`error_present`, `error_missing_for_failure`, `error_present_on_confirmed`, `error_present_on_unknown_status`) is additive and non-blocking for contract-drift triage.
- Webhook numeric fields are audit-normalized without rejection: `fee_number`/`fee_valid` and `amount`/`amount_number`/`amount_valid` are included in metadata when payloads are parseable.
- Webhook numeric anomaly flags (`amount_negative`, `amount_zero`, `fee_negative`, `fee_zero`, `fee_greater_than_amount`, `fee_equal_amount`) are additive telemetry only and do not change webhook acceptance behavior.
- Webhook numeric-shape telemetry (`amount_decimal_places`, `amount_uses_scientific_notation`, `amount_has_leading_plus`, `fee_decimal_places`, `fee_uses_scientific_notation`, `fee_has_leading_plus`) is additive audit metadata for provider payload drift triage.
- Webhook `address` is trimmed for metadata and annotated with `address_valid` plus `address_kind` (`bech32`/`base58`/`unknown`) for non-blocking payload-shape observability.
- Webhook `reference` is trimmed and bounded for metadata with `reference_truncated` to surface provider payload drift while preserving acceptance behavior.
- Webhook `id` is audit-normalized (`id`, `id_raw`, `id_length`, `id_truncated`, `id_had_surrounding_whitespace`) to surface identifier-shape drift without changing signature verification or acceptance semantics.
- When payout lookup succeeds, webhook metadata also records provider-id match telemetry (`provider_withdrawal_id`, `provider_withdrawal_id_length`, `provider_withdrawal_id_matches`, `provider_withdrawal_id_casefold_matches`) for contract-drift observability.
- Webhook `type` is normalized (`type`, `type_raw`, `type_known`) for non-blocking provider-contract drift observability.
- Webhook signature audit metadata includes `hashed_order_prefixed`, `hashed_order_valid_hex`, `hashed_order_length`, `hashed_order_expected_length`, `hashed_order_length_matches_expected`, `hashed_order_has_non_hex_chars`, and `hashed_order_had_surrounding_whitespace` for provider-format drift triage.
- Validation rejects (`400`) emit structured warning metadata under `validationFailure` (`missing_id_or_hashed_order` / `missing_status` + field/shape flags) for quick payload triage without secret leakage.
- Signature mismatches (`401`) emit structured warning metadata under `authFailure` (`reason`, withdrawal/status shape, hashed-order shape flags) for triage without logging raw digests or computed HMAC values.
- Payout lookup misses (`200` ack) emit structured warning metadata under `lookupMiss` (`withdrawal_id_*`, `status*`, `type*`) to improve webhook-delivery triage without changing retry semantics.
- Unknown payout statuses are still `200`-acked, and now emit structured warning metadata under `unknownStatus` (`withdrawal_id_*`, `status*`, `type*`) for contract-drift triage.
- Failure statuses (`failed`/`error`) missing error detail emit structured warning metadata under `failureStatusAnomaly` (shape-only) while preserving existing status handling.
- Failure statuses (`failed`/`error`) missing a valid `processed_at` emit structured warning metadata under `failureTimingAnomaly` for settlement-timestamp drift triage.
- Provider-id divergence between inbound `id` and matched payout record emits structured warning metadata under `providerIdMismatch` for contract-drift triage.
- Unknown webhook `type` values are non-blocking but emit structured warning metadata under `typeDrift` for provider contract-drift detection.
- Known statuses paired with unknown webhook types emit structured warning metadata under `statusTypeMismatch` to spotlight semantic contract drift.
- Suspicious `processed_at` values (invalid/future/stale) emit structured warning metadata under `processedAtAnomaly`; acceptance behavior remains unchanged.
- Malformed non-empty payout addresses emit structured warning metadata under `addressAnomaly` (shape-only), while webhook processing remains non-blocking.
- Oversized non-empty `reference` values emit structured warning metadata under `referenceAnomaly` when truncation occurs.
- Numeric payout value drift (negative amount/fee, or fee greater than amount) emits structured warning metadata under `valueAnomaly`.
- Input normalization drift (trimmed id/status/hashed_order whitespace or `sha256=` digest prefix) emits structured warning metadata under `inputNormalization`.
- Oversized webhook ids (metadata truncation path) emit structured warning metadata under `idShapeAnomaly`.
- Casefolded status normalization (`status_raw` differs from normalized `status`) emits structured warning metadata under `statusNormalization`.
- Casefolded type normalization (`type_raw` differs from normalized `type`) emits structured warning metadata under `typeNormalization`.
- Input canonicalization events (trimmed id/status/hash whitespace or `sha256=`-prefixed hash) emit structured warning metadata under `inputNormalization`.
- Unknown statuses that include an `error` payload emit structured warning metadata under `unknownStatusError` for contract-drift triage.
- Unknown statuses paired with known `withdrawal` type emit structured warning metadata under `unknownWithdrawalStatus` for semantic drift detection.
- `confirmed` statuses that still include an `error` payload emit structured warning metadata under `confirmedStatusError` (processing remains success-path).
- `confirmed` statuses missing a valid `processed_at` emit structured warning metadata under `confirmedTimingAnomaly` for settlement-timestamp drift triage.
- `confirmed` statuses with `fee == amount` emit structured warning metadata under `confirmedFeeEqualsAmount` for payout-value anomaly triage.
- `confirmed` statuses with `fee > amount` emit structured warning metadata under `confirmedFeeGreaterThanAmount` for settlement-anomaly triage.
- `confirmed` statuses with `amount == 0` emit structured warning metadata under `confirmedZeroAmount` for settlement-anomaly triage.
- Failure statuses (`failed`/`error`) with `fee == amount` emit structured warning metadata under `failureFeeEqualsAmount` for payout-value drift triage.
- Failure statuses (`failed`/`error`) with `amount == 0` emit structured warning metadata under `failureZeroAmount` for settlement-anomaly triage.

Purchase API input guardrails:
- `buyerPubkey` must be a 64-character hex pubkey when provided.
- `amountMsat` sent as a JSON number must be a safe integer; use a string for very large values.
- `/webhooks/mock/invoice-paid` returns `401 { ok: false, error: "Unauthorized" }` when `MOCK_WEBHOOK_SECRET` is set and mismatched.

Non-payment verification (single command):
- `npm run verify:nonpayment`
  - Runs health, auth/session smoke, payout-readiness endpoint check, and webhook sanity status check.
  - Deterministic success marker: `STAGING_SMOKE_OK`
  - Deterministic failure marker: `STAGING_SMOKE_FAIL`
  - Failure signatures are emitted as: `FAILURE_SIGNATURE: <CODE>`
  - Webhook sanity expected status is conditional:
    - If readiness says `payoutReady=true`: expect webhook `401` (invalid signature path)
    - If readiness says `payoutReady=false`: expect webhook `503` (misconfigured/blocked path)

Triage snippets (common failure signatures):
- Rerun smoke with explicit target + timeout:
  - `ORIGIN=https://staging.bitindie.io TIMEOUT_MS=20000 node scripts/staging-smoke.mjs`
- If `HEALTH_NON_200` or `HEALTH_NETWORK_ERROR`:
  - `curl -i https://staging.bitindie.io/health`
- If `READINESS_FAILED` or `READINESS_NETWORK_ERROR`:
  - `curl -i https://staging.bitindie.io/ops/payouts/readiness`
- If `AUTH_CHALLENGE_FAILED|AUTH_SESSION_FAILED|AUTH_ME_FAILED`:
  - `curl -i -X POST https://staging.bitindie.io/auth/challenge -H 'content-type: application/json' -d '{"origin":"https://staging.bitindie.io"}'`
- If `WEBHOOK_EXPECTED_401_GOT_OTHER|WEBHOOK_EXPECTED_503_GOT_OTHER|WEBHOOK_NETWORK_ERROR`:
  - `curl -i -X POST https://staging.bitindie.io/webhooks/opennode/withdrawals -H 'content-type: application/x-www-form-urlencoded' --data 'id=w_smoke&status=confirmed&processed_at=2026-01-01T00:00:00.000Z&fee=0&hashed_order=bad'`

## Catalog/download smoke snippets (local)

Replace IDs with real values from your seeded/dev DB.

Response envelope note:
- Success responses use `{ ok: true, ... }`
- Error responses use `{ ok: false, error, ... }`

```bash
# List games (optional: status/cursor/limit)
# status values: DRAFT | UNLISTED | LISTED | FEATURED | BANNED
# response includes hasMore (boolean) + nextCursor (string|null)
curl -sS "http://127.0.0.1:8787/games?status=LISTED&limit=10" | jq .

# Read one game by id
curl -sS "http://127.0.0.1:8787/games/<gameId>" | jq .

# Create release for game
curl -sS -X POST http://127.0.0.1:8787/games/<gameId>/releases \
  -H 'content-type: application/json' \
  -d '{"version":"1.0.0"}' | jq .

# Request build upload URL (persisted upload intent)
# Allowed contentType values: application/zip, application/x-zip-compressed
curl -sS -X POST http://127.0.0.1:8787/releases/<releaseId>/build-upload \
  -H 'content-type: application/json' \
  -d '{"contentType":"application/zip"}' | jq .

# Request direct build presign URL (same contentType allow-list)
# releaseVersion is trimmed server-side before object-key generation
curl -sS -X POST http://127.0.0.1:8787/storage/presign/build \
  -H 'content-type: application/json' \
  -d '{"gameId":"<gameId>","releaseVersion":"1.0.0","contentType":"application/zip"}' | jq .

# Request download URL for entitled buyer
# Download telemetry is best-effort and does not block URL issuance on event-write failures.
curl -sS "http://127.0.0.1:8787/releases/<releaseId>/download?buyerUserId=<buyerUserId>" | jq .

# Or request download URL for guest entitlement
# guestReceiptCode is trimmed + uppercased server-side for lookup
curl -sS "http://127.0.0.1:8787/releases/<releaseId>/download?guestReceiptCode=<guestReceiptCode>" | jq .
```

Ops / deployment:
- Index: `../../notes/marketplace/RUNBOOKS.md`
- Staging deploy (Hetzner): `../../notes/marketplace/staging-deploy-runbook.md`
- OpenNode payouts (webhook confirmation): `../../notes/marketplace/opennode-payout-confirmation-runbook.md`
