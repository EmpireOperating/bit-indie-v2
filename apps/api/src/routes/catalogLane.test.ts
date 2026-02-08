import fastify from 'fastify';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const GAME_ID = '11111111-1111-4111-8111-111111111111';
const RELEASE_ID = '22222222-2222-4222-8222-222222222222';
const USER_ID = '33333333-3333-4333-8333-333333333333';

describe('catalog/download lane validation + error handling', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
  });

  it('PUT /games/:gameId rejects mismatched body id', async () => {
    const prismaMock = {
      game: {
        update: vi.fn(async () => ({ id: GAME_ID })),
      },
    };

    vi.doMock('../prisma.js', () => ({ prisma: prismaMock }));
    const { registerGameRoutes } = await import('./games.js');

    const app = fastify({ logger: false });
    await registerGameRoutes(app);

    const res = await app.inject({
      method: 'PUT',
      url: `/games/${GAME_ID}`,
      payload: { id: RELEASE_ID },
    });

    expect(res.statusCode).toBe(400);
    expect(res.json().error).toContain('must match route gameId');
    expect(prismaMock.game.update).not.toHaveBeenCalled();
    await app.close();
  });

  it('POST /games maps unique constraint to 409', async () => {
    const prismaMock = {
      game: {
        create: vi.fn(async () => {
          throw { code: 'P2002' };
        }),
      },
    };

    vi.doMock('../prisma.js', () => ({ prisma: prismaMock }));
    const { registerGameRoutes } = await import('./games.js');

    const app = fastify({ logger: false });
    await registerGameRoutes(app);

    const res = await app.inject({
      method: 'POST',
      url: '/games',
      payload: {
        developerUserId: USER_ID,
        slug: 'my-game',
        title: 'My Game',
      },
    });

    expect(res.statusCode).toBe(409);
    await app.close();
  });

  it('POST /games/:gameId/releases maps foreign key errors to 404', async () => {
    const prismaMock = {
      release: {
        create: vi.fn(async () => {
          throw { code: 'P2003' };
        }),
      },
    };

    vi.doMock('../prisma.js', () => ({ prisma: prismaMock }));
    const { registerReleaseRoutes } = await import('./releases.js');

    const app = fastify({ logger: false });
    await registerReleaseRoutes(app);

    const res = await app.inject({
      method: 'POST',
      url: `/games/${GAME_ID}/releases`,
      payload: { version: '1.0.0' },
    });

    expect(res.statusCode).toBe(404);
    await app.close();
  });

  it('GET /releases/:releaseId/download rejects unsafe stored build keys', async () => {
    const prismaMock = {
      release: {
        findUnique: vi.fn(async () => ({
          id: RELEASE_ID,
          gameId: GAME_ID,
          version: '1.0.0',
          buildAsset: {
            objectKey: 'covers/not-a-build.zip',
            contentType: 'application/zip',
          },
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
      makeS3Client: () => ({
        client: {},
        cfg: { bucket: 'bucket', presignExpiresSec: 120 },
      }),
    }));
    vi.doMock('@aws-sdk/s3-request-presigner', () => ({
      getSignedUrl: vi.fn(async () => 'https://example.test/download'),
    }));

    const { registerReleaseRoutes } = await import('./releases.js');

    const app = fastify({ logger: false });
    await registerReleaseRoutes(app);

    const res = await app.inject({
      method: 'GET',
      url: `/releases/${RELEASE_ID}/download?buyerUserId=${USER_ID}`,
    });

    expect(res.statusCode).toBe(500);
    expect(prismaMock.entitlement.findFirst).not.toHaveBeenCalled();
    await app.close();
  });

  it('POST /storage/presign/cover validates MIME contentType shape', async () => {
    vi.doMock('../s3.js', () => ({
      makeS3Client: () => ({
        client: {},
        cfg: { bucket: 'bucket', presignExpiresSec: 120 },
      }),
    }));
    vi.doMock('@aws-sdk/s3-request-presigner', () => ({
      getSignedUrl: vi.fn(async () => 'https://example.test/upload'),
    }));

    const { registerStoragePresignRoutes } = await import('./storagePresign.js');

    const app = fastify({ logger: false });
    await registerStoragePresignRoutes(app);

    const res = await app.inject({
      method: 'POST',
      url: '/storage/presign/cover',
      payload: {
        gameId: GAME_ID,
        contentType: 'image/png; charset=utf-8',
      },
    });

    expect(res.statusCode).toBe(400);
    await app.close();
  });
});
