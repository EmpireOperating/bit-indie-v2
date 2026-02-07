# NEXT (bit-indie-v2)

This file is the hand-off baton for automated work ticks.

## Active
- Bring up local infra and create the initial Prisma migration.
  - `cd infra && docker compose up -d`
  - `cd apps/api && cp .env.example .env`
  - `npm run db:migrate`

## After
- Implement storage presign endpoints (cover + build zip) using MinIO.
