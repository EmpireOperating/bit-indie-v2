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

### 2) Configure API env
```bash
cd apps/api
cp .env.example .env
```

### 3) Prisma
```bash
cd apps/api
npm run db:generate
npm run db:migrate
```

### 4) Run API
```bash
cd apps/api
npm run dev
```

Health:
- `GET http://127.0.0.1:8787/health`

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

