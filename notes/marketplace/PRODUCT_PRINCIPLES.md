# Marketplace — Product Principles (v1)

These principles are the guardrails for all architecture and UX decisions.

## 1) Trust first
- Buyers must feel safe downloading builds.
- Developers must trust payouts and reporting.
- Everything important is auditable.

## 2) Premium feel, minimal friction
- No “hacker UI”.
- Fast pages, clear actions, strong typography and spacing.
- Guest purchase supported; identity upgrade later.

## 3) DRM-free by default
- Downloads are time-limited links, not a launcher.
- Integrity is enforced via checksums + metadata.
- Abuse is handled via rate limits + anomaly detection + manual admin tools.

## 4) Creator experience is a first-class product
- Uploading a build should be calm and reliable.
- Releases are versioned.
- Clear status: draft → review checks → published.

## 5) Money correctness > everything
- Ledger-backed accounting.
- Idempotent webhooks.
- Retry-safe payouts.

## 6) Optional integrations are outputs, not inputs
- Nostr mirroring, social features, etc. are downstream jobs.
- Core truth lives in the marketplace DB.

## 7) Security and safety posture
- Private builds in storage; presigned downloads.
- Malware scanning pipeline can be added as a gate later.
- Admin kill-switch exists for malware/spam.
