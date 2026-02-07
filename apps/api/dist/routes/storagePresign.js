import { PutObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { z } from 'zod';
import { makeS3Client } from '../s3.js';
import { makeBuildObjectKey, makeCoverObjectKey } from '../storageKeys.js';
const uuidSchema = z.string().uuid();
// Keep this permissive-ish (we can tighten later), but prevent path traversal / weird keys.
const semverishSchema = z
    .string()
    .min(1)
    .max(64)
    .regex(/^[0-9A-Za-z][0-9A-Za-z.+_-]*$/);
const coverBodySchema = z.object({
    gameId: uuidSchema,
    contentType: z.string().min(1),
});
const buildBodySchema = z.object({
    gameId: uuidSchema,
    releaseVersion: semverishSchema,
    contentType: z.string().min(1).default('application/zip'),
});
// moved to storageKeys.ts
export async function registerStoragePresignRoutes(app) {
    // NOTE: Do not construct the S3 client at server boot.
    // In dev/test, missing S3 env vars should not prevent the API from starting;
    // instead, fail only when the presign endpoints are called.
    app.post('/storage/presign/cover', async (req, reply) => {
        const parsed = coverBodySchema.safeParse(req.body);
        if (!parsed.success) {
            return reply.status(400).send({
                ok: false,
                error: 'Invalid request body',
                issues: parsed.error.issues,
            });
        }
        const { gameId, contentType } = parsed.data;
        // Deterministic key so retries are idempotent.
        const objectKey = makeCoverObjectKey({ gameId, contentType });
        let client, cfg;
        try {
            ({ client, cfg } = makeS3Client());
        }
        catch (e) {
            return reply.status(500).send({ ok: false, error: e.message });
        }
        const command = new PutObjectCommand({
            Bucket: cfg.bucket,
            Key: objectKey,
            ContentType: contentType,
        });
        const uploadUrl = await getSignedUrl(client, command, {
            expiresIn: cfg.presignExpiresSec,
        });
        return {
            ok: true,
            bucket: cfg.bucket,
            objectKey,
            uploadUrl,
            expiresInSec: cfg.presignExpiresSec,
        };
    });
    app.post('/storage/presign/build', async (req, reply) => {
        const parsed = buildBodySchema.safeParse(req.body);
        if (!parsed.success) {
            return reply.status(400).send({
                ok: false,
                error: 'Invalid request body',
                issues: parsed.error.issues,
            });
        }
        const { gameId, releaseVersion, contentType } = parsed.data;
        const objectKey = makeBuildObjectKey({ gameId, releaseVersion, contentType });
        let client, cfg;
        try {
            ({ client, cfg } = makeS3Client());
        }
        catch (e) {
            return reply.status(500).send({ ok: false, error: e.message });
        }
        const command = new PutObjectCommand({
            Bucket: cfg.bucket,
            Key: objectKey,
            ContentType: contentType,
        });
        const uploadUrl = await getSignedUrl(client, command, {
            expiresIn: cfg.presignExpiresSec,
        });
        return {
            ok: true,
            bucket: cfg.bucket,
            objectKey,
            uploadUrl,
            expiresInSec: cfg.presignExpiresSec,
        };
    });
}
