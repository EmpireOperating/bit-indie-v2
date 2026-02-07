# Marketplace — DB Schema v1 (draft)

This is a draft schema outline. We’ll convert to migrations once implementation starts.

## Notes on identifiers
- `pubkey` is the canonical identity anchor (from Embedded Signer).
- We still use internal UUIDs for tables where convenient.

## Tables (high level)

### users
- id (uuid pk)
- pubkey (text unique, NOT NULL)
- display_name (text)
- avatar_url (text)
- created_at, updated_at

### developer_profiles
- user_id (fk users.id unique)
- payout_ln_address (text NOT NULL)
- created_at, updated_at

### games
- id (uuid pk)
- developer_user_id (fk users.id)
- slug (text unique)
- title (text)
- summary (text)
- description_md (text)
- status (text enum)
- created_at, updated_at

### releases
- id (uuid pk)
- game_id (fk games.id)
- version (text)
- release_notes_md (text)
- published_at (timestamptz)
- created_at, updated_at

### build_assets
- id (uuid pk)
- release_id (fk releases.id unique)  # 1 build per release in v1
- object_key (text)
- sha256 (text)
- size_bytes (bigint)
- content_type (text)
- created_at

### purchases
- id (uuid pk)
- buyer_user_id (fk users.id nullable)
- guest_receipt_code (text unique nullable)
- game_id (fk games.id)
- invoice_provider (text)
- invoice_id (text unique)
- status (text enum)
- amount_msat (bigint)
- paid_at (timestamptz)
- created_at, updated_at

### entitlements
- id (uuid pk)
- purchase_id (fk purchases.id unique)
- buyer_user_id (fk users.id nullable)
- guest_receipt_code (text unique nullable)
- game_id (fk games.id)
- granted_at (timestamptz)
- revoked_at (timestamptz nullable)

### download_events
- id (uuid pk)
- entitlement_id (fk entitlements.id)
- release_id (fk releases.id)
- ip_hash (text)
- user_agent (text)
- created_at (timestamptz)

### ledger_entries
- id (uuid pk)
- purchase_id (fk purchases.id)
- type (text)
- amount_msat (bigint)
- meta_json (jsonb)
- created_at

### payouts
- id (uuid pk)
- purchase_id (fk purchases.id unique)
- developer_user_id (fk users.id)
- destination_ln_address (text)
- amount_msat (bigint)
- status (text)
- attempt_count (int)
- last_error (text)
- idempotency_key (text unique)
- created_at, updated_at

## Indexes / constraints (must-have)
- users(pubkey) unique
- games(slug) unique
- purchases(invoice_id) unique
- entitlements(purchase_id) unique
- payouts(purchase_id) unique
- payouts(idempotency_key) unique
