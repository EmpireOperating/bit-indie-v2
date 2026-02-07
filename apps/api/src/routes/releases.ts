import type { FastifyInstance } from 'fastify';
import { PutObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
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

export async function registerReleaseRoutes(app: FastifyInstance) {
  const { client, cfg } = makeS3Client();

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
}
