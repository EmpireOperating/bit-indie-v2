# Marketplace — Runbooks index

This is a tiny index of operator/developer runbooks that are meant to be followed step-by-step.

## OpenNode payouts
- Payout confirmation (webhook + callback URL): `opennode-payout-confirmation-runbook.md`
- Preflight checklist (before touching staging/prod): `opennode-payout-confirmation-preflight.md`

## Local no-secrets quality gate (safe for unattended FLW waves)
Run from `projects/bit-indie-v2/apps/api`:

```bash
npm test --silent
npm run build --silent
rg -n '^(<<<<<<<|=======|>>>>>>>)' ../../.. && { echo 'merge markers found'; exit 1; } || true
```

Use this gate between FLW waves before carrying forward lane backlog.

## FLW queue-mode (4 strict non-overlapping lanes)
Use exactly four lanes per wave and keep each lane focused on one area:

1. **Lane A — correctness/tests** (new or strengthened tests)
2. **Lane B — runtime hardening** (edge-case handling, safer defaults)
3. **Lane C — reliability/ops ergonomics** (logs, cli ergonomics, guardrails)
4. **Lane D — runbook/docs** (operator clarity, step-by-step commands)

At wave boundary:
- Run quality gate above.
- Verdict is `GO`, `PARTIAL` (only if carry-forward is isolated and safe), or `STOP`.
- Stop immediately if lane output devolves into low-value churn/thrash.
