# NEXT (bit-indie-v2)

This file is the hand-off baton for automated work ticks.

## Active
- Wire cover/build objectKeys into Prisma models and validate inputs.
  - Add `Game.coverObjectKey` (nullable) if not present.
  - Ensure there is a place to store build upload `objectKey` for a release/build asset.
  - Add basic input validation in routes that accept these keys.

## After
- Wire presigned upload flow into create/update game + create release build upload.
