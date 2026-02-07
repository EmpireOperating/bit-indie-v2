# NEXT (bit-indie-v2)

This file is the hand-off baton for automated work ticks.

## Active
- Add front-end wiring (admin UI) for cover + build uploads.
  - Use existing API endpoints:
    - POST /storage/presign/cover
    - POST /releases/:releaseId/build-upload
  - Minimal happy-path UX: select file → upload to presigned URL → persist returned objectKey via game/release routes.

## After
- Add download flow: presigned download URL + entitlement checks.
