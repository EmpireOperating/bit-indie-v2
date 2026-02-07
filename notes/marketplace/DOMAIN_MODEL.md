# Marketplace — Domain Model (v1)

This is the canonical conceptual model. DB schema should map 1:1.

## Core entities

### User
- Represents a person (or later: org) using the marketplace.
- Auth: Embedded Signer identity (pubkey as canonical identity id).

Key fields:
- `id` (internal)
- `pubkey` (x-only secp256k1 pubkey; canonical identity)
- profile metadata (display name, avatar)

### DeveloperProfile
- 1:1 with User.
- Holds payout destination and any verification state.

Key fields:
- `user_id`
- `payout_ln_address`
- `verified` (future)

### Game
- A listing owned by a developer.

Key fields:
- `developer_user_id`
- `slug`
- `title`, `summary`, `description`
- `status`: `DRAFT | UNLISTED | LISTED | FEATURED | BANNED`

### Release
- A versioned release for a game.

Key fields:
- `game_id`
- `version` (semver string)
- `release_notes`
- `published_at`

### BuildAsset
- The downloadable artifact for a release.

v1 rule:
- exactly **one** primary build zip per release.

Key fields:
- `release_id`
- `object_key` (S3)
- `sha256`
- `size_bytes`
- `content_type`

### Purchase
- A payment attempt + finalization record.

Key fields:
- `purchase_id`
- `buyer_user_id` (nullable for guest)
- `guest_receipt_code` (for guest)
- `game_id` (and/or `release_id` depending on policy)
- `invoice_provider`, `invoice_id`
- `status`: `PENDING | PAID | EXPIRED | FAILED | REFUNDED` (refunds likely off in v1 policy but keep state machine)

### Entitlement
- The durable “right to download”.

v1 rule:
- Entitlements are granted only when the purchase is `PAID`.
- A purchase entitles the **whole game** (all current + future releases), not a single release.

Key fields:
- `entitlement_id`
- `purchase_id`
- `game_id`
- `granted_at`
- `revoked_at` (admin)

### DownloadEvent
- Audit trail for downloads.

Key fields:
- `entitlement_id`
- `release_id`
- `ip_hash` (privacy-preserving)
- `user_agent`
- `created_at`

### LedgerEntry
- Financial truth.

Key fields:
- `entry_id`
- `purchase_id`
- `type`: `INVOICE_CREATED | INVOICE_PAID | PLATFORM_FEE | DEVELOPER_NET | PAYOUT_SENT | PAYOUT_FAILED`
- `amount_msat`
- `currency` (sats/msats)
- `meta_json`

### Payout
- Represents a payout attempt to a developer.

Key fields:
- `payout_id`
- `developer_user_id`
- `purchase_id`
- `amount_msat`
- `destination_ln_address`
- `status`: `SCHEDULED | SENT | FAILED | RETRYING | CANCELED`
- `idempotency_key`

## Notes
- Guest purchases are supported by using `guest_receipt_code` and allowing later claim into a user account.
- Nostr/social outputs are modeled as async jobs, not core entities.
