# Staging deploy runbook (Hetzner) — Bit Indie V2 API

This runbook assumes a Hetzner Cloud VPS (Ubuntu 24.04) with Docker + docker compose installed.

## Current staging server
- IPv4: `89.167.43.73`
- Project: `bitindie-staging`

## Secrets / credentials
- Stored locally (gitignored): `ops/secrets/hetzner/bitindie-staging.json`

## Goals
- Have `https://staging.bitindie.io/health` return OK.
- Have OpenNode withdrawals webhook reachable at:
  - `https://staging.bitindie.io/webhooks/opennode/withdrawals`

## Steps

### 0) Repo layout gotcha (IMPORTANT)
This repo is *not* a node workspace root.
- Repo root: `/home/josh/clawd/projects/bit-indie-v2`
- Node app root: `/home/josh/clawd/projects/bit-indie-v2/apps/api`

When you run node scripts/builds/tests, **always** `cd .../apps/api` first.

### 1) (Local) sanity check before touching the server
From this machine:
- `cd /home/josh/clawd/projects/bit-indie-v2/apps/api`
- `npm ci`
- `npm run build`
- `npm test`

If any of these fail, stop and fix locally before deploying.

### 2) SSH in
- `ssh -i ~/.ssh/bitindie_hetzner_staging root@89.167.43.73`

### 3) Server layout + reproducible checkout
On the VPS, keep everything under `/opt/bitindie-staging/`:
- `/opt/bitindie-staging/compose.yml` (compose file)
- `/opt/bitindie-staging/.env` (secrets/env for compose)
- `/opt/bitindie-staging/src/bit-indie-v2` (git checkout used for the build)

Create dirs:
- `mkdir -p /opt/bitindie-staging/src`

Clone (canonical remote):
- `cd /opt/bitindie-staging/src`
- `git clone https://github.com/EmpireOperating/bit-indie-v2.git bit-indie-v2`

Checkout a specific ref (tag/sha) so deploys are reproducible:
- `cd /opt/bitindie-staging/src/bit-indie-v2`
- `git fetch --all --tags`

Sanity check: ensure the working tree is clean before switching refs
- `git status`
- If you see local changes, decide whether to `git stash -u` (recommended) or `git reset --hard` (destructive)

Then:
- `git checkout <tag-or-sha>`

Verify you’re on the intended ref (and paste this into the deploy history):
- `git rev-parse --short HEAD`
- Record that short sha in: `/home/josh/clawd/notes/marketplace/staging-deploy-history.md`

Copy/paste helper (single command; fetches the **intended** short sha over SSH and appends it to deploy history locally):
```bash
printf '%s %s (note: intended deploy (pre-compose up))\\n' "$(date +'%F %R')" "$(ssh -i ~/.ssh/bitindie_hetzner_staging root@89.167.43.73 'cd /opt/bitindie-staging/src/bit-indie-v2 && git rev-parse --short HEAD')" >> /home/josh/clawd/notes/marketplace/staging-deploy-history.md
```

Example (current known good on this workstation at time of writing):
- `git checkout 4855534f13cd8c14650eecc58408f693c1a547b6`
- `git rev-parse --short HEAD`

### 3a) Record the currently deployed version (sha)
Before you change anything, capture what’s currently running so rollback is easy.

On the VPS:
- `cd /opt/bitindie-staging/src/bit-indie-v2`
- `git rev-parse HEAD`
- (Optional) `git show -s --format=%ci HEAD`

Optional copy/paste helper (run locally; prints the currently deployed short sha over SSH):
```bash
ssh -i ~/.ssh/bitindie_hetzner_staging root@89.167.43.73 'cd /opt/bitindie-staging/src/bit-indie-v2 && git rev-parse --short HEAD'
```

Optional copy/paste helper (single command; fetches sha over SSH and appends to deploy history locally):
```bash
printf '%s %s (note: currently deployed (pre-change))\n' "$(date +'%F %R')" "$(ssh -i ~/.ssh/bitindie_hetzner_staging root@89.167.43.73 'cd /opt/bitindie-staging/src/bit-indie-v2 && git rev-parse --short HEAD')" >> /home/josh/clawd/notes/marketplace/staging-deploy-history.md
```

Write it down locally in:
- `/home/josh/clawd/notes/marketplace/staging-deploy-history.md`

Suggested entry format:
- `YYYY-MM-DD HH:MM <sha> (note: why / what changed)`

Copy/paste helper (appends to history; run locally on this workstation):
```bash
# replace <sha> + note, then run:
printf '%s %s (note: %s)\n' "$(date +'%F %R')" "<sha>" "why / what changed" >> /home/josh/clawd/notes/marketplace/staging-deploy-history.md
```

### 3b) Update / redeploy (existing server)
When you already have a working staging stack and just need to roll it forward to a new tag/sha:

1) **Record the currently deployed sha (right before checking out a new ref):**
- `cd /opt/bitindie-staging/src/bit-indie-v2`
- `git rev-parse HEAD`
- (Optional) `git show -s --format=%ci HEAD`

Optional copy/paste helper (run locally; prints the currently deployed short sha over SSH):
```bash
ssh -i ~/.ssh/bitindie_hetzner_staging root@89.167.43.73 'cd /opt/bitindie-staging/src/bit-indie-v2 && git rev-parse --short HEAD'
```

Optional copy/paste helper (single command; fetches sha over SSH and appends to deploy history locally):
```bash
printf '%s %s (note: currently deployed (pre-change))\n' "$(date +'%F %R')" "$(ssh -i ~/.ssh/bitindie_hetzner_staging root@89.167.43.73 'cd /opt/bitindie-staging/src/bit-indie-v2 && git rev-parse --short HEAD')" >> /home/josh/clawd/notes/marketplace/staging-deploy-history.md
```

Write it down locally in:
- `/home/josh/clawd/notes/marketplace/staging-deploy-history.md`

Suggested entry format:
- `YYYY-MM-DD HH:MM <sha> (note: why / what changed)`

Copy/paste helper (appends to history; run locally on this workstation):
```bash
# replace <sha> + note, then run:
printf '%s %s (note: %s)\n' "$(date +'%F %R')" "<sha>" "why / what changed" >> /home/josh/clawd/notes/marketplace/staging-deploy-history.md
```

2) Update the checkout (in the repo on the VPS):
- `cd /opt/bitindie-staging/src/bit-indie-v2`
- `git fetch --all --tags`

**Sanity check: ensure the working tree is clean before switching refs**
- `git status`
- If you see local changes:
  - If they’re junk / accidental: `git reset --hard` (careful: destructive)
  - If you want to keep them: `git stash -u` (recommended for quick safety) or commit them to a branch

Then check out the target ref:
- `git checkout <tag-or-sha>`

Verify you’re on the intended ref (and paste this into the deploy history):
- `git rev-parse --short HEAD`
- Record that short sha in: `/home/josh/clawd/notes/marketplace/staging-deploy-history.md`

Copy/paste helper (single command; fetches the **intended** short sha over SSH and appends it to deploy history locally):
```bash
printf '%s %s (note: intended deploy (pre-compose up))\\n' "$(date +'%F %R')" "$(ssh -i ~/.ssh/bitindie_hetzner_staging root@89.167.43.73 'cd /opt/bitindie-staging/src/bit-indie-v2 && git rev-parse --short HEAD')" >> /home/josh/clawd/notes/marketplace/staging-deploy-history.md
```

3) Rebuild + restart the compose stack:
- `cd /opt/bitindie-staging`
- `docker compose --env-file .env up -d --build`

If the server has a Makefile (recommended), this is usually equivalent to:
- `make redeploy`

4) Apply DB migrations (Prisma):
- `cd /opt/bitindie-staging`
- `docker compose exec api sh -lc 'cd /app && npm run prisma -- migrate deploy'`

5) Minimal smoke checks:
- `curl -fsS https://staging.bitindie.io/health`
- (Optional) Verify the OpenNode withdrawals webhook route exists:
  - `curl -i https://staging.bitindie.io/webhooks/opennode/withdrawals`

6) Post-deploy: record the **new** deployed sha (so history reflects what’s running *now*):
- On the VPS:
  - `cd /opt/bitindie-staging/src/bit-indie-v2`
  - `git rev-parse --short HEAD`
- Add an entry (at top) to:
  - `/home/josh/clawd/notes/marketplace/staging-deploy-history.md`
  - Format: `YYYY-MM-DD HH:MM <sha> (note: deployed (smoke checks OK))`

Copy/paste helper (appends to history; run locally on this workstation):

Single command (fetches the *new* deployed sha over SSH and appends it to history):
```bash
printf '%s %s (note: deployed (smoke checks OK))\n' "$(date +'%F %R')" "$(ssh -i ~/.ssh/bitindie_hetzner_staging root@89.167.43.73 'cd /opt/bitindie-staging/src/bit-indie-v2 && git rev-parse --short HEAD')" >> /home/josh/clawd/notes/marketplace/staging-deploy-history.md
```

Manual version (if you already have the sha handy):
```bash
# replace <sha> + note, then run:
printf '%s %s (note: %s)\n' "$(date +'%F %R')" "<sha>" "deployed (smoke checks OK)" >> /home/josh/clawd/notes/marketplace/staging-deploy-history.md
```

If anything fails, check `docker compose logs -f api` and consider rolling back by checking out the previous known-good sha and repeating steps (2)-(4).

### 3c) Rollback + troubleshooting

#### Roll back to previous known-good sha
1) Identify the last known-good sha/tag (from your notes, or by listing recent history):
- `cd /opt/bitindie-staging/src/bit-indie-v2`
- `git log --oneline -n 20`

2) Check it out:
- (Sanity) `git status` should show a clean working tree. If it doesn’t, `git stash -u` or `git reset --hard` before switching.
- `git checkout <previous-known-good-sha-or-tag>`

3) Rebuild + restart:
- `cd /opt/bitindie-staging`
- `docker compose --env-file .env up -d --build`

4) Apply migrations (safe to re-run; Prisma is idempotent on applied migrations):
- `docker compose exec api sh -lc 'cd /app && npm run prisma -- migrate deploy'`

5) Smoke check:
- `curl -fsS https://staging.bitindie.io/health`

#### Quick troubleshooting commands
From `/opt/bitindie-staging`:
- `docker compose ps`
- `docker compose logs -f api`
- `docker compose logs -f postgres`
- `docker compose logs -f minio`

(If you need a shell inside the api container)
- `docker compose exec api sh`

#### If `prisma migrate deploy` fails
1) Grab the error + context:
- `docker compose logs -n 200 --no-color api`

2) Verify env + DB connectivity (common causes):
- `docker compose exec api sh -lc 'node -v && npm -v'`
- `docker compose exec api sh -lc 'echo "$DATABASE_URL"'`

3) Get Prisma’s view of the world:
- `docker compose exec api sh -lc 'cd /app && npm run prisma -- migrate status'`

4) If the failure is due to a bad migration, **stop** and roll back to the previous known-good sha.
   - Avoid ad-hoc manual SQL edits unless you have a clear recovery plan / snapshot.

### 4) Bring up stack (compose)
Create `/opt/bitindie-staging/compose.yml`.

Copy/paste template (api + postgres + minio):

```yaml
services:
  api:
    build:
      # On the server, this should point at a checkout of this repo.
      # Example: /opt/bitindie-staging/src/bit-indie-v2/apps/api
      context: ./src/bit-indie-v2/apps/api
    container_name: bitindie-v2-api
    restart: unless-stopped
    healthcheck:
      test: ["CMD-SHELL", "wget -qO- http://127.0.0.1:8787/health >/dev/null || exit 1"]
      interval: 10s
      timeout: 3s
      retries: 5
      start_period: 10s
    environment:
      HOST: 0.0.0.0
      PORT: 8787

      # internal postgres
      DATABASE_URL: postgresql://marketplace:${POSTGRES_PASSWORD}@postgres:5432/marketplace?schema=marketplace_api_v2

      # internal minio (S3-compatible)
      S3_ENDPOINT: http://minio:9000
      S3_REGION: auto
      S3_BUCKET: marketplace
      S3_ACCESS_KEY: ${MINIO_ROOT_USER}
      S3_SECRET_KEY: ${MINIO_ROOT_PASSWORD}
      # IMPORTANT: public base URL should be reachable from the user's browser.
      # For now, keep it off until we decide if we want to proxy MinIO publicly.
      # S3_PUBLIC_BASE_URL: https://staging.bitindie.io/minio/marketplace

      # OpenNode
      OPENNODE_API_KEY: ${OPENNODE_API_KEY}
      OPENNODE_BASE_URL: ${OPENNODE_BASE_URL}
      OPENNODE_WITHDRAWAL_CALLBACK_URL: https://staging.bitindie.io/webhooks/opennode/withdrawals

    depends_on:
      - postgres
      - minio
      - minio-init

    # expose only to localhost; Caddy terminates TLS publicly
    ports:
      - "127.0.0.1:8787:8787"

  postgres:
    image: postgres:16-alpine
    container_name: bitindie-v2-postgres-staging
    restart: unless-stopped
    environment:
      POSTGRES_USER: marketplace
      POSTGRES_PASSWORD: ${POSTGRES_PASSWORD}
      POSTGRES_DB: marketplace
    volumes:
      - bitindie_v2_pgdata_staging:/var/lib/postgresql/data

  minio:
    image: minio/minio:RELEASE.2025-01-20T14-49-07Z
    container_name: bitindie-v2-minio-staging
    restart: unless-stopped
    command: server /data --console-address ":9001"
    environment:
      MINIO_ROOT_USER: ${MINIO_ROOT_USER}
      MINIO_ROOT_PASSWORD: ${MINIO_ROOT_PASSWORD}
    volumes:
      - bitindie_v2_minio_staging:/data

  minio-init:
    image: minio/mc:RELEASE.2025-01-17T23-25-50Z
    depends_on:
      - minio
    entrypoint: ["/bin/sh","-lc"]
    command: |
      set -e
      mc alias set local http://minio:9000 "$$MINIO_ROOT_USER" "$$MINIO_ROOT_PASSWORD"
      mc mb --ignore-existing local/marketplace
      mc anonymous set download local/marketplace || true
      echo "minio-init ok"
    environment:
      MINIO_ROOT_USER: ${MINIO_ROOT_USER}
      MINIO_ROOT_PASSWORD: ${MINIO_ROOT_PASSWORD}

volumes:
  bitindie_v2_pgdata_staging:
  bitindie_v2_minio_staging:
```

Also create `/opt/bitindie-staging/.env`:

```bash
# postgres
POSTGRES_PASSWORD=change-me

# minio
MINIO_ROOT_USER=minio
MINIO_ROOT_PASSWORD=change-me

# opennode
OPENNODE_API_KEY=change-me
# optional; leave blank to use OpenNode default
OPENNODE_BASE_URL=
```

Start / update:
- `cd /opt/bitindie-staging && docker compose --env-file .env up -d --build`

(Optional but recommended) add `/opt/bitindie-staging/Makefile` so deploys are one command:

```makefile
redeploy:
	docker compose --env-file .env up -d --build
	docker compose exec api sh -lc 'cd /app && npm run prisma -- migrate deploy'

logs:
	docker compose logs -f --tail=200 api

ps:
	docker compose ps
```

Then you can redeploy with:
- `cd /opt/bitindie-staging && make redeploy`

### 5) DB migrate (Prisma)
Run migrations against the staging DB.

If you can run commands inside the `api` container:
- `docker compose exec api sh -lc 'cd /app && npm run prisma -- migrate deploy'`

(Adjust `/app` if your Dockerfile uses a different WORKDIR.)

### 6) Reverse proxy + TLS (Caddy)
Install Caddy and configure it to terminate TLS for `staging.bitindie.io`.

Minimal Caddyfile block (copy/paste):

```caddyfile
staging.bitindie.io {
  encode zstd gzip

  # API
  reverse_proxy 127.0.0.1:8787 {
    # minimal hardening
    header_up X-Forwarded-Proto {scheme}
    header_up X-Forwarded-Host {host}

    transport http {
      dial_timeout 5s
      response_header_timeout 30s
      read_timeout 30s
      write_timeout 30s
    }
  }

  # Optional hardening
  header {
    Strict-Transport-Security "max-age=31536000; includeSubDomains; preload"
    X-Content-Type-Options "nosniff"
    X-Frame-Options "DENY"
    Referrer-Policy "no-referrer"
  }
}
```

Reload:
- `sudo caddy reload --config /etc/caddy/Caddyfile`

### 7) DNS
- Add `A` record: `staging.bitindie.io` → `89.167.43.73`

### 8) OpenNode webhook
- Set env:
  - `OPENNODE_WITHDRAWAL_CALLBACK_URL=https://staging.bitindie.io/webhooks/opennode/withdrawals`
  - `OPENNODE_API_KEY=...`
- Verify via OpenNode test withdrawal + webhook receipt.

## Notes
- Prefer SSH key auth; avoid keeping root passwords in email.
- Keep staging money-adjacent actions limited to verification.
