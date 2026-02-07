# Marketplace — Jobs & Artifacts (v1)

We run important side-effects as durable jobs with audit artifacts.

## Job runner
- Use BullMQ queue + worker(s).
- For agent-driven tasks, the worker can spawn OpenClaw isolated runs.
- For deterministic tasks, use exec-style jobs.

## Artifact standard
Each job writes under:
- `notes/runs/marketplace/<jobId>/`
  - `run.json` (inputs, timestamps, idempotency key)
  - `result.json` (structured outputs)
  - `summary.md` (human readable)
  - `logs.txt` (stdout/stderr)
  - `diff.patch` (optional)

## v1 jobs
- `payout.send` — send LN payment to dev (idempotent)
- `storage.scan` — (future) scan uploaded build zip
- `nostr.mirror` — (future) publish update events
- `housekeeping` — cleanup old sessions, etc.

## Failure policy
- Only alert on actionable failures (payout failures, repeated webhook errors, storage access failures).
- Keep noise low; write artifacts always.
