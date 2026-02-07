# NEXT (bit-indie-v2)

This file is the hand-off baton for automated work ticks.

## Active
- Wire presigned upload flow into create/update game + create release build upload (API integration first).
  - Add minimal routes for: create/update game (incl. coverObjectKey), create release, request build upload (persist objectKey).
  - Keep everything idempotent; validate objectKey prefixes (covers/ + builds/).

## After
- Add front-end wiring (admin UI) for cover + build uploads.
