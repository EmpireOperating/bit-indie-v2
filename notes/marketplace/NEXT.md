# NEXT (bit-indie-v2)

This file is the hand-off baton for automated work ticks.

## Active
- Admin uploads page: add a “download latest build” button for quick manual QA.
  - Should call `GET /releases/:releaseId/download` with `buyerUserId` or `guestReceiptCode` and then navigate to the returned `downloadUrl`.
  - Keep it happy-path; no auth yet.

## After
- Tighten entitlement gate once auth/session identity is wired in (don’t rely on query params).
