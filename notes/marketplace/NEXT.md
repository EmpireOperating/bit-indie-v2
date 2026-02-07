# NEXT (bit-indie-v2)

This file is the hand-off baton for automated work ticks.

## Active
- Mirror the minimal admin uploads UI into the canonical marketplace API repo (`projects/marketplace/apps/api`).
  - Add GET /admin/uploads page (same as bit-indie-v2) that can:
    - POST /storage/presign/cover → PUT to S3 → PUT /games/:gameId {coverObjectKey}
    - POST /releases/:releaseId/build-upload → PUT to S3

## After
- Add download flow: presigned download URL + entitlement checks.
