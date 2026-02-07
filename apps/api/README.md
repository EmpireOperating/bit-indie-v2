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
