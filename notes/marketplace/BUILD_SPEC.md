# Marketplace — Build Spec (canonical)

This is the single-source description of what we are building, so we can restart sessions without losing the plot.

## North star
A Lightning-native game marketplace that feels premium, is trustworthy, and is operationally boring.

- DRM-free downloads
- Versioned releases
- Game-wide entitlements (buy once, get all future releases)
- Per-sale payouts to developer LN Address
- Strong audit trail + idempotency

## Core principles
See: `notes/marketplace/PRODUCT_PRINCIPLES.md`.

## Canonical domain model
See: `notes/marketplace/DOMAIN_MODEL.md`.

## Key product decisions (v1)
### Identity/auth
- Embedded Signer is the identity spine.
- Users are identified by **pubkey** (x-only secp256k1, 32 bytes).
- Marketplace server treats its own DB as source of truth; signer is used for proof of identity and sessions.

### Commerce
- Platform fee: 10%
- Policy: final sale (no standard refunds)
- Purchase entitles the **whole game** (all current + future releases)
- Guest checkout: supported (receipt code can be claimed later)

### Releases + builds
- Games have versioned releases (semver string).
- One build zip per release.
- Downloads default to latest published release.

### Storage + downloads
- Private S3 bucket for builds.
- Presigned URLs for upload + download.
- Integrity stored: sha256 + size + content-type.

See: `notes/marketplace/STORAGE_DOWNLOADS.md`.

### Payments + payouts
- Receive then pay (custodial from a UX standpoint).
- Ledger-backed truth.
- Webhooks + payouts are idempotent and retry-safe.

See: `notes/marketplace/PAYMENTS_PAYOUTS.md`.

### Background jobs
- Deterministic workers (no AI required for core product).
- Optional ops hook: Railgun/OpenClaw can run operational jobs with artifacts, but product does not depend on it.

See: `notes/marketplace/JOBS_AND_ARTIFACTS.md`.

## Repos / code layout (current)
- New marketplace scaffold: `projects/marketplace/`
- Embedded Signer upstream: `projects/embedded-signer/` (source: github.com/LemonSchneid/Embedded-Signer)
- bit-indie legacy: `projects/bit-indie/` (source: github.com/LemonSchneid/bit-indie)
