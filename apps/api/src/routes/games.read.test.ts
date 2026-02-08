import fastify from 'fastify';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const GAME_ID = '11111111-1111-4111-8111-111111111111';

describe('games read endpoints', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
  });

  it('GET /games validates query and rejects invalid status', async () => {
    const prismaMock = { game: { findMany: vi.fn() } };
    vi.doMock('../prisma.js', () => ({ prisma: prismaMock }));

    const { registerGameRoutes } = await import('./games.js');
    const app = fastify({ logger: false });
    await registerGameRoutes(app);

    const res = await app.inject({ method: 'GET', url: '/games?status=NOT_A_REAL_STATUS' });

    expect(res.statusCode).toBe(400);
    expect(prismaMock.game.findMany).not.toHaveBeenCalled();
    await app.close();
  });

  it('GET /games validates query and rejects oversized limit', async () => {
    const prismaMock = { game: { findMany: vi.fn() } };
    vi.doMock('../prisma.js', () => ({ prisma: prismaMock }));

    const { registerGameRoutes } = await import('./games.js');
    const app = fastify({ logger: false });
    await registerGameRoutes(app);

    const res = await app.inject({ method: 'GET', url: '/games?limit=1000' });

    expect(res.statusCode).toBe(400);
    expect(prismaMock.game.findMany).not.toHaveBeenCalled();
    await app.close();
  });

  it('GET /games supports status filter and cursor pagination', async () => {
    const prismaMock = {
      game: {
        findMany: vi.fn(async () => [
          { id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', status: 'LISTED' },
          { id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', status: 'LISTED' },
        ]),
      },
    };
    vi.doMock('../prisma.js', () => ({ prisma: prismaMock }));

    const { registerGameRoutes } = await import('./games.js');
    const app = fastify({ logger: false });
    await registerGameRoutes(app);

    const res = await app.inject({
      method: 'GET',
      url: '/games?status=LISTED&limit=2&cursor=99999999-9999-4999-8999-999999999999',
    });

    expect(res.statusCode).toBe(200);
    expect(prismaMock.game.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { status: 'LISTED' },
        take: 2,
        cursor: { id: '99999999-9999-4999-8999-999999999999' },
        skip: 1,
      }),
    );

    const body = res.json();
    expect(body.ok).toBe(true);
    expect(body.nextCursor).toBe('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb');
    await app.close();
  });

  it('GET /games/:gameId returns 404 when record is missing', async () => {
    const prismaMock = {
      game: {
        findUnique: vi.fn(async () => null),
      },
    };
    vi.doMock('../prisma.js', () => ({ prisma: prismaMock }));

    const { registerGameRoutes } = await import('./games.js');
    const app = fastify({ logger: false });
    await registerGameRoutes(app);

    const res = await app.inject({ method: 'GET', url: `/games/${GAME_ID}` });

    expect(res.statusCode).toBe(404);
    expect(res.json().error).toContain('Game not found');
    await app.close();
  });
});
