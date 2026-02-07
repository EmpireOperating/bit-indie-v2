# Marketplace — Storage & Downloads (v1)

## Storage posture
- Builds are stored in a **private** S3-compatible bucket.
- Downloads are served via **presigned GET** URLs.
- Uploads are done via **presigned POST** (or PUT) with content-length constraints.

## Object key scheme (v1)

### Covers
- `games/<gameId>/covers/<coverId>.png`

### Builds
- `games/<gameId>/releases/<releaseId>/build.zip`

(We keep room for later: `extras/`, `screenshots/`, `trailers/`.)

## Presign TTLs
- Upload presign TTL: 15 minutes
- Download presign TTL: 15 minutes (extendable)

## Allowed content
- Build: `application/zip`
- Cover: `image/png` (optionally jpeg/webp later)

## Integrity fields
For every build asset we store:
- `sha256`
- `size_bytes`
- `content_type`

## Download rules
- Entitlement required.
- Entitlement is game-wide; downloads default to the **latest published release**.
- Audit `DownloadEvent` each time a presigned URL is issued.

## Abuse posture (v1)
- Rate limit presign issuance per entitlement.
- Track anomalies by `ip_hash` + `user_agent` patterns.
- Admin can revoke entitlement and/or ban game.

## Future upgrade hooks
- Optional malware scanning job for uploaded zips.
- Optional watermarking pipeline (post-purchase personalized build) — NOT v1.
