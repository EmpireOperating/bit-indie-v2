# NEXT (bit-indie-v2)

This file is the hand-off baton for automated work ticks.

## Active
- Add download flow: presigned download URL + entitlement checks.
  - API: `GET /releases/:releaseId/download` (or similar) returns presigned URL.
  - Enforce entitlement (purchase/guest receipt) before issuing URL.
  - Record `DownloadEvent` (best-effort).

## After
- Admin uploads page: add a “download latest build” button for quick manual QA.
