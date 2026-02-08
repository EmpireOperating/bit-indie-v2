import type { FastifyInstance } from 'fastify';
import { GetObjectCommand, PutObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { z } from 'zod';
import { prisma } from '../prisma.js';
import { getSessionById } from '../auth/session.js';
import { makeS3Client } from '../s3.js';
import { assertPrefix, makeBuildObjectKey } from '../storageKeys.js';
import { mapPrismaWriteError } from './prismaErrors.js';
import { recordDownloadEventBestEffort } from './downloadTelemetry.js';
import { fail, ok } from './httpResponses.js';

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
  contentType: z
    .enum(['application/zip', 'application/x-zip-compressed'])
    .default('application/zip'),
});

const normalizedGuestReceiptSchema = z
  .string()
  .trim()
  .min(4)
  .max(128)
  .transform((v) => v.toUpperCase());

const downloadQuerySchema = z
  .object({
    buyerUserId: uuidSchema.optional(),
    guestReceiptCode: normalizedGuestReceiptSchema.optional(),
    accessToken: z.string().trim().min(1).max(128).optional(),
  })
  .refine((v) => Boolean(v.buyerUserId || v.guestReceiptCode || v.accessToken), {
    message: 'Provide buyerUserId, guestReceiptCode, or accessToken',
  });

const UUID_LIKE_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function extractBearerToken(authorizationHeader: unknown): string | null {
  if (typeof authorizationHeader !== 'string') return null;
  const trimmed = authorizationHeader.trim();
  if (!trimmed) return null;
  const [scheme, value] = trimmed.split(/\s+/, 2);
  if (!scheme || !value) return null;
  if (scheme.toLowerCase() !== 'bearer') return null;
  return value;
}

function extractCookieToken(cookieHeader: unknown, cookieName: string): string | null {
  if (typeof cookieHeader !== 'string') return null;
  const pairs = cookieHeader.split(';');
  for (const pair of pairs) {
    const [rawName, ...rawValueParts] = pair.split('=');
    const name = rawName?.trim();
    if (!name || name !== cookieName) continue;
    const rawValue = rawValueParts.join('=').trim();
    if (!rawValue) return null;
    return decodeURIComponent(rawValue);
  }
  return null;
}

export async function registerReleaseRoutes(app: FastifyInstance) {
  // NOTE: Do not construct the S3 client at server boot.
  // In dev/test, missing S3 env vars should not prevent the API from starting.

  app.post('/games/:gameId/releases', async (req, reply) => {
    const gameIdParsed = uuidSchema.safeParse((req.params as any).gameId);
    if (!gameIdParsed.success) {
      return reply.status(400).send(fail('Invalid gameId'));
    }

    const parsed = createReleaseBodySchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.status(400).send(fail('Invalid request body', { issues: parsed.error.issues }));
    }

    try {
      const release = await prisma.release.create({
        data: {
          gameId: gameIdParsed.data,
          version: parsed.data.version,
          releaseNotesMd: parsed.data.releaseNotesMd ?? null,
        },
      });

      return ok({ release });
    } catch (e) {
      const mapped = mapPrismaWriteError(e, {
        P2002: 'Release with same unique field already exists',
        P2003: 'Referenced record not found',
      });
      if (mapped) return reply.status(mapped.status).send(fail(mapped.error));
      throw e;
    }
  });

  // Request a presigned upload URL for a build zip.
  // We persist (upsert) the intent so retries are idempotent.
  app.post('/releases/:releaseId/build-upload', async (req, reply) => {
    const releaseIdParsed = uuidSchema.safeParse((req.params as any).releaseId);
    if (!releaseIdParsed.success) {
      return reply.status(400).send(fail('Invalid releaseId'));
    }

    const parsed = requestBuildUploadBodySchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.status(400).send(fail('Invalid request body', { issues: parsed.error.issues }));
    }

    const release = await prisma.release.findUnique({
      where: { id: releaseIdParsed.data },
      select: { id: true, gameId: true, version: true },
    });
    if (!release) {
      return reply.status(404).send(fail('Release not found'));
    }

    const objectKey = makeBuildObjectKey({
      gameId: release.gameId,
      releaseVersion: release.version,
      contentType: parsed.data.contentType,
    });

    try {
      assertPrefix(objectKey, 'builds/');
    } catch {
      return reply.status(500).send(fail('Invalid generated build object key'));
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
      return reply.status(500).send(fail((e as Error).message));
    }

    const command = new PutObjectCommand({
      Bucket: cfg.bucket,
      Key: objectKey,
      ContentType: parsed.data.contentType,
    });

    const uploadUrl = await getSignedUrl(client, command, {
      expiresIn: cfg.presignExpiresSec,
    });

    return ok({
      intent,
      bucket: cfg.bucket,
      objectKey,
      uploadUrl,
      expiresInSec: cfg.presignExpiresSec,
    });
  });

  // Download flow (v1): entitlement gate + presigned S3 GET.
  // NOTE: No auth middleware yet; caller supplies buyerUserId or guestReceiptCode.
  app.get('/releases/:releaseId/download', async (req, reply) => {
    const releaseIdParsed = uuidSchema.safeParse((req.params as any).releaseId);
    if (!releaseIdParsed.success) {
      return reply.status(400).send(fail('Invalid releaseId'));
    }

    const accessTokenFromAuthorization = extractBearerToken(req.headers.authorization);
    const accessTokenFromCookie = extractCookieToken((req.headers as any).cookie, 'bi_session');

    const qParsed = downloadQuerySchema.safeParse({
      ...(req.query as Record<string, unknown>),
      accessToken:
        (req.query as Record<string, unknown> | undefined)?.accessToken ??
        accessTokenFromAuthorization ??
        accessTokenFromCookie ??
        undefined,
    });
    if (!qParsed.success) {
      return reply.status(400).send(fail('Invalid query', { issues: qParsed.error.issues }));
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
      return reply.status(404).send(fail('Release not found'));
    }
    if (!release.buildAsset) {
      return reply.status(409).send(fail('Release has no build asset yet'));
    }

    try {
      assertPrefix(release.buildAsset.objectKey, 'builds/');
    } catch {
      return reply.status(500).send(fail('Invalid build object key metadata'));
    }

    const accessToken = qParsed.data.accessToken;
    const accessTokenSource =
      (req.query as Record<string, unknown> | undefined)?.accessToken != null
        ? 'query'
        : accessTokenFromAuthorization
          ? 'authorization_header'
          : accessTokenFromCookie
            ? 'cookie'
            : 'none';

    let buyerUserIdFromToken: string | null = null;
    if (accessToken) {
      const token = accessToken;
      if (!UUID_LIKE_RE.test(token)) {
        return reply.status(401).send(fail('Invalid session token'));
      }

      let session;
      try {
        session = await getSessionById(token);
      } catch (e) {
        req.log.error({ err: e }, 'Session store unavailable');
        return reply.status(503).send(fail('Session store unavailable'));
      }

      if (!session || session.expiresAt.getTime() <= Date.now()) {
        return reply.status(401).send(fail('Invalid session token'));
      }

      const sessionUser = await prisma.user.findUnique({
        where: { pubkey: session.pubkey },
        select: { id: true },
      });
      if (!sessionUser) {
        return reply.status(403).send(fail('Not entitled'));
      }
      buyerUserIdFromToken = sessionUser.id;
    }

    const entitlementOr = [
      buyerUserIdFromToken ? { buyerUserId: buyerUserIdFromToken } : null,
      qParsed.data.buyerUserId ? { buyerUserId: qParsed.data.buyerUserId } : null,
      qParsed.data.guestReceiptCode ? { guestReceiptCode: qParsed.data.guestReceiptCode } : null,
    ].filter((v): v is { buyerUserId: string } | { guestReceiptCode: string } => v != null);

    const entitlementMode = buyerUserIdFromToken
      ? 'tokenized_access'
      : qParsed.data.buyerUserId
        ? 'buyer_user'
        : 'guest_receipt';

    const entitlementPath = {
      mode: entitlementMode,
      tokenSource: accessTokenSource,
      usedBuyerUserId: Boolean(buyerUserIdFromToken || qParsed.data.buyerUserId),
      usedGuestReceiptCode: Boolean(qParsed.data.guestReceiptCode),
      supportsTokenizedAccess: true,
      supportsDirectDownloadAccess: true,
    } as const;

    const entitlement = await prisma.entitlement.findFirst({
      where: {
        gameId: release.gameId,
        revokedAt: null,
        OR: entitlementOr,
      },
      select: { id: true },
    });

    if (!entitlement) {
      return reply.status(403).send(fail('Not entitled'));
    }

    await recordDownloadEventBestEffort({
      prisma,
      entitlementId: entitlement.id,
      releaseId: release.id,
      ipRaw: req.ip || '',
      userAgentRaw: String((req.headers as any)['user-agent'] ?? ''),
    });

    let client, cfg;
    try {
      ({ client, cfg } = makeS3Client());
    } catch (e) {
      return reply.status(500).send(fail((e as Error).message));
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

    return ok({
      bucket: cfg.bucket,
      objectKey: release.buildAsset.objectKey,
      downloadUrl,
      expiresInSec: cfg.presignExpiresSec,
      entitlementMode,
      entitlementPath,
    });
  });
}
