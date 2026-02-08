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
  it('accepts accessToken and resolves entitlement by session pubkey user', async () => {
    const ACCESS_TOKEN = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
    const prismaMock = {
      release: {
        findUnique: vi.fn(async () => ({
          id: RELEASE_ID,
          gameId: '11111111-1111-4111-8111-111111111111',
          version: '1.0.0',
          buildAsset: { objectKey: 'builds/game/1.0.0.zip', contentType: 'application/zip' },
        })),
      },
      apiSession: {
        findUnique: vi.fn(async () => ({
          id: ACCESS_TOKEN,
          pubkey: '0x' + '11'.repeat(32),
          origin: 'https://example.com:443',
          scopesJson: [],
          createdAt: new Date(),
          expiresAt: new Date(Date.now() + 60_000),
        })),
      },
      user: {
        findUnique: vi.fn(async () => ({ id: 'user_from_session' })),
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
      url: `/releases/${RELEASE_ID}/download?accessToken=${ACCESS_TOKEN}`,
      remoteAddress: '127.0.0.1',
      headers: { 'user-agent': 'vitest-agent' },
    });

    expect(res.statusCode).toBe(200);
    expect(prismaMock.entitlement.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          OR: [{ buyerUserId: 'user_from_session' }],
        }),
      }),
    );
    await app.close();
  });

  it('accepts bearer token in Authorization header for tokenized download access', async () => {
    const ACCESS_TOKEN = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
    const prismaMock = {
      release: {
        findUnique: vi.fn(async () => ({
          id: RELEASE_ID,
          gameId: '11111111-1111-4111-8111-111111111111',
          version: '1.0.0',
          buildAsset: { objectKey: 'builds/game/1.0.0.zip', contentType: 'application/zip' },
        })),
      },
      apiSession: {
        findUnique: vi.fn(async () => ({
          id: ACCESS_TOKEN,
          pubkey: '0x' + '22'.repeat(32),
          origin: 'https://example.com:443',
          scopesJson: [],
          createdAt: new Date(),
          expiresAt: new Date(Date.now() + 60_000),
        })),
      },
      user: {
        findUnique: vi.fn(async () => ({ id: 'user_from_bearer' })),
      },
      entitlement: {
        findFirst: vi.fn(async () => ({ id: 'ent_2' })),
      },
      downloadEvent: {
        create: vi.fn(async () => ({ id: 'evt_2' })),
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
      headers: { authorization: `Bearer ${ACCESS_TOKEN}` },
      remoteAddress: '127.0.0.1',
    });

    expect(res.statusCode).toBe(200);
    expect(prismaMock.entitlement.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          OR: [{ buyerUserId: 'user_from_bearer' }, { guestReceiptCode: 'ABCD-1234' }],
        }),
      }),
    );

    await app.close();
  });

  it('rejects malformed accessToken with 401', async () => {
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
      url: `/releases/${RELEASE_ID}/download?accessToken=not-a-token`,
    });

    expect(res.statusCode).toBe(401);
    expect(prismaMock.entitlement.findFirst).not.toHaveBeenCalled();
    await app.close();
  });

});
