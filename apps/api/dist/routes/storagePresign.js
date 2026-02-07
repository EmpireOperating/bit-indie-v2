import { createHash } from 'node:crypto';
import { PutObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { z } from 'zod';
import { makeS3Client } from '../s3.js';
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
function sha256Hex(input) {
    return createHash('sha256').update(input).digest('hex');
}
function extForContentType(contentType) {
    if (contentType === 'image/png')
        return 'png';
    if (contentType === 'image/jpeg')
        return 'jpg';
    if (contentType === 'image/webp')
        return 'webp';
    if (contentType === 'application/zip')
        return 'zip';
    return 'bin';
}
export async function registerStoragePresignRoutes(app) {
    const { client, cfg } = makeS3Client();
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
        const ext = extForContentType(contentType);
        // Deterministic key so retries are idempotent.
        const keyHash = sha256Hex(`cover:${gameId}:${contentType}`);
        const objectKey = `covers/${gameId}/${keyHash}.${ext}`;
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
        const ext = extForContentType(contentType);
        const keyHash = sha256Hex(`build:${gameId}:${releaseVersion}:${contentType}`);
        const objectKey = `builds/${gameId}/${releaseVersion}/${keyHash}.${ext}`;
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
