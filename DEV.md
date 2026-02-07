# Bit Indie V2 — Dev / Agent Handoff (Start Here)

This repo is the **canonical implementation** right now.

Goal: a Lightning-native, Steam-like DRM-free game marketplace that works for **humans and agents**.

Canonical spec lives in the parent workspace:
- `/home/josh/clawd/notes/marketplace/BUILD_SPEC.md`

Key integration docs (workspace root):
- `notes/marketplace/INTEGRATION_CONTRACT_EMBEDDED_SIGNER.md`
- `notes/marketplace/DEVELOPER_GUIDE_SIGNER.md`
- `notes/marketplace/AGENT_HEADLESS_GUIDE.md`

## Repo layout
- `apps/api` — Fastify + Prisma + Postgres + MinIO
- `infra/docker-compose.yml` — local Postgres + MinIO
- `notes/marketplace/NEXT.md` — repo-local baton mirror of the current Active work

## Current status / baton
- Current baton: `notes/marketplace/NEXT.md`
- If a baton item is marked **BLOCKED**, it usually means it requires a real deploy target / env vars / DB access.

## Local dev setup

### 1) Start infra (Postgres + MinIO)
```bash
cd infra
docker compose up -d
```

Ports:
- Postgres: `127.0.0.1:55432`
- MinIO: `127.0.0.1:59000` (console `59001`)

### Local “staging” (Docker, local-only)
This repo includes a local-only staging compose that runs its own Postgres + MinIO on **separate ports** so it won’t clash with your dev infra.

Start it:
```bash
cd apps/api
docker compose -f docker-compose.staging.yml up -d --build
```

Then run migrations against that staging DB (note the different port/schema are already baked into the compose `DATABASE_URL`):
```bash
cd apps/api
npm ci
npm run db:generate
npm run db:migrate
```

API (staging):
- `GET http://127.0.0.1:8788/health`

MinIO (staging):
- S3: `http://127.0.0.1:59002`
- Console: `http://127.0.0.1:59003`

### 2) Configure API env
```bash
cd apps/api
cp .env.example .env
```

OpenNode (withdrawals webhook):
- set `OPENNODE_WITHDRAWAL_CALLBACK_URL=http://127.0.0.1:8787/webhooks/opennode/withdrawals`
- docs: `apps/api/docs/opennode-withdrawals-webhook.md`

### 3) Prisma
```bash
cd apps/api
npm run db:generate
npm run db:migrate
```

If you change `DATABASE_URL` schema settings and Prisma reports drift, you can reset the dev DB:
```bash
cd apps/api
npx prisma migrate reset --force
```

### 4) Run API
```bash
cd apps/api
npm run dev
```

Health:
- `GET http://127.0.0.1:8787/health`

## Auth quickstart (headless + browser)

After you implement a client-side signer:
- Browser: call `/auth/challenge` → sign → `/auth/session` → you get a cookie (`bi_session`)
- Headless agent: same flow, but use the returned `accessToken` as `Authorization: Bearer <accessToken>`

Convenience:
- `GET /me` works with either cookie or bearer.

## Important conventions

### Identity
- Identity is `pubkey` (x-only secp256k1, hex 0x-prefixed).
- Embedded Signer is the intended client identity spine.

### Storage
- Covers + builds stored in MinIO/S3 with presigned URLs.

### Idempotency
- Writes should become idempotent (agents will retry).
- Prefer `Idempotency-Key` headers + DB-level dedupe keys.

## Operator-only (real env) steps
Some work requires a real deploy target (staging/prod) and secrets/env-vars.
Those steps should be documented as a runbook under:
- `notes/marketplace/*runbook*.md`

Quick links:
- Runbooks index: `notes/marketplace/RUNBOOKS.md`
- Staging deploy (Hetzner): `notes/marketplace/staging-deploy-runbook.md`

### VPS deploy artifact: `bitindie-api-src.tgz` (optional / legacy)
The canonical staging deploy steps live in `notes/marketplace/staging-deploy-runbook.md`.

This tarball flow is still useful when you want to ship a build context without doing a full git checkout on the VPS.

Create the tarball from this repo:
```bash
cd /home/josh/clawd/projects/bit-indie-v2
./scripts/make-bitindie-api-src-tgz.sh
# -> writes ./out/bitindie-api-src.tgz
```

Copy it to the VPS:
```bash
scp -i ~/.ssh/bitindie_hetzner_staging out/bitindie-api-src.tgz \
  root@89.167.43.73:/opt/bitindie-staging/bitindie-api-src.tgz
```

Then on the VPS:
```bash
cd /opt/bitindie-staging
make redeploy
```

