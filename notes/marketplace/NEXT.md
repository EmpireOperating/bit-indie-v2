# NEXT (bit-indie-v2)

This file is the hand-off baton for automated work ticks.

## Active
- Implement storage presign endpoints (cover + build zip) using MinIO.
  - Add Fastify routes:
    - `POST /storage/presign/cover`
    - `POST /storage/presign/build`
  - Use S3-compatible signing against local MinIO.

## After
- Wire presigned upload flow into create/update game + create release build upload.
