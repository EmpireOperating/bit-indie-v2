import type { FastifyInstance } from 'fastify';
import { GetObjectCommand, PutObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import crypto from 'node:crypto';
import { z } from 'zod';
import { prisma } from '../prisma.js';
import { makeS3Client } from '../s3.js';
import { assertPrefix, makeBuildObjectKey } from '../storageKeys.js';

const uuidSchema = z.string().uuid();

const semverishSchema = z
  .string()
  .min(1)
  .max(64)
  .regex(/^[0-9A-Za-z][0-9A-Za-z.+_-]*$/);

const createReleaseBodySchema = z.object({
  version: semverishSchema,
  releaseNotesMd: z.string().max(200_000).optional().nullable(),
});

const requestBuildUploadBodySchema = z.object({
  contentType: z.string().min(1).default('application/zip'),
});

const downloadQuerySchema = z
  .object({
    buyerUserId: uuidSchema.optional(),
    guestReceiptCode: z.string().min(4).max(128).optional(),
  })
  .refine((v) => Boolean(v.buyerUserId || v.guestReceiptCode), {
    message: 'Provide buyerUserId or guestReceiptCode',
  });

export async function registerReleaseRoutes(app: FastifyInstance) {
  // NOTE: Do not construct the S3 client at server boot.
  // In dev/test, missing S3 env vars should not prevent the API from starting.

  app.post('/games/:gameId/releases', async (req, reply) => {
    const gameIdParsed = uuidSchema.safeParse((req.params as any).gameId);
    if (!gameIdParsed.success) {
      return reply.status(400).send({ ok: false, error: 'Invalid gameId' });
    }

    const parsed = createReleaseBodySchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.status(400).send({
        ok: false,
        error: 'Invalid request body',
        issues: parsed.error.issues,
      });
    }

    const release = await prisma.release.create({
      data: {
        gameId: gameIdParsed.data,
        version: parsed.data.version,
        releaseNotesMd: parsed.data.releaseNotesMd ?? null,
      },
    });

    return { ok: true, release };
  });

  // Request a presigned upload URL for a build zip.
  // We persist (upsert) the intent so retries are idempotent.
  app.post('/releases/:releaseId/build-upload', async (req, reply) => {
    const releaseIdParsed = uuidSchema.safeParse((req.params as any).releaseId);
    if (!releaseIdParsed.success) {
      return reply.status(400).send({ ok: false, error: 'Invalid releaseId' });
    }

    const parsed = requestBuildUploadBodySchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.status(400).send({
        ok: false,
        error: 'Invalid request body',
        issues: parsed.error.issues,
      });
    }

    const release = await prisma.release.findUnique({
      where: { id: releaseIdParsed.data },
      select: { id: true, gameId: true, version: true },
    });
    if (!release) {
      return reply.status(404).send({ ok: false, error: 'Release not found' });
    }

    const objectKey = makeBuildObjectKey({
      gameId: release.gameId,
      releaseVersion: release.version,
      contentType: parsed.data.contentType,
    });

    try {
      assertPrefix(objectKey, 'builds/');
    } catch (e) {
      return reply.status(500).send({ ok: false, error: (e as Error).message });
    }

    const intent = await prisma.buildUploadIntent.upsert({
      where: { releaseId: release.id },
      create: {
        releaseId: release.id,
        objectKey,
        contentType: parsed.data.contentType,
      },
      update: {
        objectKey,
        contentType: parsed.data.contentType,
      },
    });

    let client, cfg;
    try {
      ({ client, cfg } = makeS3Client());
    } catch (e) {
      return reply.status(500).send({ ok: false, error: (e as Error).message });
    }

    const command = new PutObjectCommand({
      Bucket: cfg.bucket,
      Key: objectKey,
      ContentType: parsed.data.contentType,
    });

    const uploadUrl = await getSignedUrl(client, command, {
      expiresIn: cfg.presignExpiresSec,
    });

    return {
      ok: true,
      intent,
      bucket: cfg.bucket,
      objectKey,
      uploadUrl,
      expiresInSec: cfg.presignExpiresSec,
    };
  });

  // Download flow (v1): entitlement gate + presigned S3 GET.
  // NOTE: No auth middleware yet; caller supplies buyerUserId or guestReceiptCode.
  app.get('/releases/:releaseId/download', async (req, reply) => {
    const releaseIdParsed = uuidSchema.safeParse((req.params as any).releaseId);
    if (!releaseIdParsed.success) {
      return reply.status(400).send({ ok: false, error: 'Invalid releaseId' });
    }

    const qParsed = downloadQuerySchema.safeParse(req.query);
    if (!qParsed.success) {
      return reply.status(400).send({
        ok: false,
        error: 'Invalid query',
        issues: qParsed.error.issues,
      });
    }

    const release = await prisma.release.findUnique({
      where: { id: releaseIdParsed.data },
      select: {
        id: true,
        gameId: true,
        version: true,
        buildAsset: { select: { objectKey: true, contentType: true } },
      },
    });
    if (!release) {
      return reply.status(404).send({ ok: false, error: 'Release not found' });
    }
    if (!release.buildAsset) {
      return reply.status(409).send({ ok: false, error: 'Release has no build asset yet' });
    }

    const entitlement = await prisma.entitlement.findFirst({
      where: {
        gameId: release.gameId,
        revokedAt: null,
        OR: [
          qParsed.data.buyerUserId ? { buyerUserId: qParsed.data.buyerUserId } : undefined,
          qParsed.data.guestReceiptCode
            ? { guestReceiptCode: qParsed.data.guestReceiptCode }
            : undefined,
        ].filter(Boolean) as any,
      },
      select: { id: true },
    });

    if (!entitlement) {
      return reply.status(403).send({ ok: false, error: 'Not entitled' });
    }

    // Best-effort event record (avoid blocking download if this fails).
    try {
      const ip = (req.ip || '').trim();
      const ipHash = crypto.createHash('sha256').update(ip).digest('hex');
      const userAgent = String((req.headers as any)['user-agent'] ?? '').slice(0, 512) || null;

      await prisma.downloadEvent.create({
        data: {
          entitlementId: entitlement.id,
          releaseId: release.id,
          ipHash,
          userAgent,
        },
      });
    } catch {
      // swallow
    }

    let client, cfg;
    try {
      ({ client, cfg } = makeS3Client());
    } catch (e) {
      return reply.status(500).send({ ok: false, error: (e as Error).message });
    }

    const command = new GetObjectCommand({
      Bucket: cfg.bucket,
      Key: release.buildAsset.objectKey,
      ResponseContentType: release.buildAsset.contentType,
      // optional: hint file name later when we have a canonical slug
      // ResponseContentDisposition: `attachment; filename="build-${release.version}.zip"`,
    });

    const downloadUrl = await getSignedUrl(client, command, {
      expiresIn: cfg.presignExpiresSec,
    });

    return {
      ok: true,
      bucket: cfg.bucket,
      objectKey: release.buildAsset.objectKey,
      downloadUrl,
      expiresInSec: cfg.presignExpiresSec,
    };
  });
}
