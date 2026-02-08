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

OpenNode webhook verification (local/dev):
- Docs: `./docs/opennode-withdrawals-webhook.md`
- Helper:
  - `OPENNODE_API_KEY=... node scripts/opennode-withdrawal-webhook.mjs hash <withdrawalId>`
  - `OPENNODE_API_KEY=... node scripts/opennode-withdrawal-webhook.mjs curl http://127.0.0.1:8787 <withdrawalId> confirmed`

Non-payment verification (single command):
- `npm run verify:nonpayment`
  - Runs health, auth/session smoke, payout-readiness endpoint check, and webhook sanity status check.

Ops / deployment:
- Index: `../../notes/marketplace/RUNBOOKS.md`
- Staging deploy (Hetzner): `../../notes/marketplace/staging-deploy-runbook.md`
- OpenNode payouts (webhook confirmation): `../../notes/marketplace/opennode-payout-confirmation-runbook.md`
