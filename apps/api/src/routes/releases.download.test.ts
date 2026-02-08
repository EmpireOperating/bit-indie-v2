import fastify from 'fastify';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const RELEASE_ID = '22222222-2222-4222-8222-222222222222';

describe('release download guest receipt + telemetry behavior', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
  });

  it('normalizes guestReceiptCode by trim + uppercase before entitlement lookup', async () => {
    const prismaMock = {
      release: {
        findUnique: vi.fn(async () => ({
          id: RELEASE_ID,
          gameId: '11111111-1111-4111-8111-111111111111',
          version: '1.0.0',
          buildAsset: { objectKey: 'builds/game/1.0.0.zip', contentType: 'application/zip' },
        })),
      },
      entitlement: {
        findFirst: vi.fn(async () => ({ id: 'ent_1' })),
      },
      downloadEvent: {
        create: vi.fn(async () => ({ id: 'evt_1' })),
      },
    };

    vi.doMock('../prisma.js', () => ({ prisma: prismaMock }));
    vi.doMock('../s3.js', () => ({
      makeS3Client: () => ({ client: {}, cfg: { bucket: 'bucket', presignExpiresSec: 60 } }),
    }));
    vi.doMock('@aws-sdk/s3-request-presigner', () => ({
      getSignedUrl: vi.fn(async () => 'https://example.test/download'),
    }));

    const { registerReleaseRoutes } = await import('./releases.js');

    const app = fastify({ logger: false });
    await registerReleaseRoutes(app);

    const res = await app.inject({
      method: 'GET',
      url: `/releases/${RELEASE_ID}/download?guestReceiptCode=%20ab-123-cd%20`,
    });

    expect(res.statusCode).toBe(200);
    expect(prismaMock.entitlement.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          OR: [{ guestReceiptCode: 'AB-123-CD' }],
        }),
      }),
    );
    await app.close();
  });

  it('skips downloadEvent.create when request IP is empty', async () => {
    const prismaMock = {
      release: {
        findUnique: vi.fn(async () => ({
          id: RELEASE_ID,
          gameId: '11111111-1111-4111-8111-111111111111',
          version: '1.0.0',
          buildAsset: { objectKey: 'builds/game/1.0.0.zip', contentType: 'application/zip' },
        })),
      },
      entitlement: {
        findFirst: vi.fn(async () => ({ id: 'ent_1' })),
      },
      downloadEvent: {
        create: vi.fn(async () => ({ id: 'evt_1' })),
      },
    };

    vi.doMock('../prisma.js', () => ({ prisma: prismaMock }));
    vi.doMock('../s3.js', () => ({
      makeS3Client: () => ({ client: {}, cfg: { bucket: 'bucket', presignExpiresSec: 60 } }),
    }));
    vi.doMock('@aws-sdk/s3-request-presigner', () => ({
      getSignedUrl: vi.fn(async () => 'https://example.test/download'),
    }));

    const { registerReleaseRoutes } = await import('./releases.js');

    const app = fastify({ logger: false });
    await registerReleaseRoutes(app);

    const res = await app.inject({
      method: 'GET',
      url: `/releases/${RELEASE_ID}/download?guestReceiptCode=ABCD-1234`,
      remoteAddress: '   ',
    });

    expect(res.statusCode).toBe(200);
    expect(prismaMock.downloadEvent.create).not.toHaveBeenCalled();
    await app.close();
  });

  it('keeps download successful when downloadEvent.create throws', async () => {
    const prismaMock = {
      release: {
        findUnique: vi.fn(async () => ({
          id: RELEASE_ID,
          gameId: '11111111-1111-4111-8111-111111111111',
          version: '1.0.0',
          buildAsset: { objectKey: 'builds/game/1.0.0.zip', contentType: 'application/zip' },
        })),
      },
      entitlement: {
        findFirst: vi.fn(async () => ({ id: 'ent_1' })),
      },
      downloadEvent: {
        create: vi.fn(async () => {
          throw new Error('db write failed');
        }),
      },
    };

    vi.doMock('../prisma.js', () => ({ prisma: prismaMock }));
    vi.doMock('../s3.js', () => ({
      makeS3Client: () => ({ client: {}, cfg: { bucket: 'bucket', presignExpiresSec: 60 } }),
    }));
    vi.doMock('@aws-sdk/s3-request-presigner', () => ({
      getSignedUrl: vi.fn(async () => 'https://example.test/download'),
    }));

    const { registerReleaseRoutes } = await import('./releases.js');

    const app = fastify({ logger: false });
    await registerReleaseRoutes(app);

    const res = await app.inject({
      method: 'GET',
      url: `/releases/${RELEASE_ID}/download?guestReceiptCode=ABCD-1234`,
      remoteAddress: '127.0.0.1',
      headers: { 'user-agent': 'vitest-agent' },
    });

    expect(res.statusCode).toBe(200);
    expect(prismaMock.downloadEvent.create).toHaveBeenCalledTimes(1);
    await app.close();
  });
});
