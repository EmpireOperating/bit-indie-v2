import fastify from 'fastify';
import { beforeEach, describe, expect, it, vi } from 'vitest';

describe('/me auth guard', () => {
  beforeEach(() => {
    vi.resetModules();
  });

  it('returns 401 when auth is missing', async () => {
    const prismaMock = { apiSession: { findUnique: vi.fn(async () => null) } };
    vi.doMock('../prisma.js', () => ({ prisma: prismaMock }));
    const { registerMeRoutes } = await import('./me.js');

    const app = fastify({ logger: false });
    await app.register((await import('@fastify/cookie')).default, { secret: 'test' });
    await registerMeRoutes(app);

    const res = await app.inject({ method: 'GET', url: '/me' });
    expect(res.statusCode).toBe(401);
    expect(res.json().error).toBe('Unauthorized');
    expect(prismaMock.apiSession.findUnique).not.toHaveBeenCalled();
    await app.close();
  });

  it('returns 401 for malformed bearer token before DB lookup', async () => {
    const prismaMock = { apiSession: { findUnique: vi.fn(async () => null) } };
    vi.doMock('../prisma.js', () => ({ prisma: prismaMock }));
    const { registerMeRoutes } = await import('./me.js');

    const app = fastify({ logger: false });
    await app.register((await import('@fastify/cookie')).default, { secret: 'test' });
    await registerMeRoutes(app);

    const res = await app.inject({
      method: 'GET',
      url: '/me',
      headers: { authorization: 'Bearer not-a-uuid' },
    });

    expect(res.statusCode).toBe(401);
    expect(res.json().error).toBe('Invalid session');
    expect(prismaMock.apiSession.findUnique).not.toHaveBeenCalled();
    await app.close();
  });

  it('does not fall back to cookie when bearer token is malformed but non-empty', async () => {
    const prismaMock = { apiSession: { findUnique: vi.fn(async () => null) } };
    vi.doMock('../prisma.js', () => ({ prisma: prismaMock }));
    const { registerMeRoutes } = await import('./me.js');

    const app = fastify({ logger: false });
    await app.register((await import('@fastify/cookie')).default, { secret: 'test' });
    await registerMeRoutes(app);

    const res = await app.inject({
      method: 'GET',
      url: '/me',
      headers: { authorization: 'Bearer not-a-uuid' },
      cookies: { bi_session: '11111111-1111-4111-8111-111111111111' },
    });

    expect(res.statusCode).toBe(401);
    expect(res.json().error).toBe('Invalid session');
    expect(prismaMock.apiSession.findUnique).not.toHaveBeenCalled();
    await app.close();
  });

  it('uses cookie session when bearer token is empty', async () => {
    const expiresAt = new Date(Date.now() + 60_000);
    const prismaMock = {
      apiSession: {
        findUnique: vi.fn(async () => ({
          id: '11111111-1111-4111-8111-111111111111',
          pubkey: '0x' + 'aa'.repeat(32),
          origin: 'https://example.com:443',
          scopesJson: [],
          createdAt: new Date(),
          expiresAt,
        })),
      },
    };
    vi.doMock('../prisma.js', () => ({ prisma: prismaMock }));
    const { registerMeRoutes } = await import('./me.js');

    const app = fastify({ logger: false });
    await app.register((await import('@fastify/cookie')).default, { secret: 'test' });
    await registerMeRoutes(app);

    const res = await app.inject({
      method: 'GET',
      url: '/me',
      headers: { authorization: 'Bearer    ' },
      cookies: { bi_session: '11111111-1111-4111-8111-111111111111' },
    });

    expect(res.statusCode).toBe(200);
    expect(prismaMock.apiSession.findUnique).toHaveBeenCalledWith({
      where: { id: '11111111-1111-4111-8111-111111111111' },
    });
    await app.close();
  });

  it('uses cookie session when authorization scheme is not bearer', async () => {
    const expiresAt = new Date(Date.now() + 60_000);
    const prismaMock = {
      apiSession: {
        findUnique: vi.fn(async () => ({
          id: '11111111-1111-4111-8111-111111111111',
          pubkey: '0x' + 'aa'.repeat(32),
          origin: 'https://example.com:443',
          scopesJson: [],
          createdAt: new Date(),
          expiresAt,
        })),
      },
    };
    vi.doMock('../prisma.js', () => ({ prisma: prismaMock }));
    const { registerMeRoutes } = await import('./me.js');

    const app = fastify({ logger: false });
    await app.register((await import('@fastify/cookie')).default, { secret: 'test' });
    await registerMeRoutes(app);

    const res = await app.inject({
      method: 'GET',
      url: '/me',
      headers: { authorization: 'Basic xyz' },
      cookies: { bi_session: '11111111-1111-4111-8111-111111111111' },
    });

    expect(res.statusCode).toBe(200);
    expect(prismaMock.apiSession.findUnique).toHaveBeenCalledWith({
      where: { id: '11111111-1111-4111-8111-111111111111' },
    });
    await app.close();
  });

  it('returns 503 when session storage throws', async () => {
    const prismaMock = {
      apiSession: {
        findUnique: vi.fn(async () => {
          throw new Error('db down');
        }),
      },
    };
    vi.doMock('../prisma.js', () => ({ prisma: prismaMock }));
    const { registerMeRoutes } = await import('./me.js');

    const app = fastify({ logger: false });
    await app.register((await import('@fastify/cookie')).default, { secret: 'test' });
    await registerMeRoutes(app);

    const res = await app.inject({
      method: 'GET',
      url: '/me',
      headers: { authorization: 'Bearer 11111111-1111-4111-8111-111111111111' },
    });

    expect(res.statusCode).toBe(503);
    expect(res.json().error).toBe('Session store unavailable');
    await app.close();
  });

  it('returns 401 when session is expired', async () => {
    const prismaMock = {
      apiSession: {
        findUnique: vi.fn(async () => ({
          id: '11111111-1111-4111-8111-111111111111',
          pubkey: '0x' + 'aa'.repeat(32),
          origin: 'https://example.com:443',
          scopesJson: [],
          createdAt: new Date(),
          expiresAt: new Date(Date.now() - 1_000),
        })),
      },
    };

    vi.doMock('../prisma.js', () => ({ prisma: prismaMock }));
    const { registerMeRoutes } = await import('./me.js');

    const app = fastify({ logger: false });
    await app.register((await import('@fastify/cookie')).default, { secret: 'test' });
    await registerMeRoutes(app);

    const res = await app.inject({
      method: 'GET',
      url: '/me',
      headers: { authorization: 'Bearer 11111111-1111-4111-8111-111111111111' },
    });

    expect(res.statusCode).toBe(401);
    expect(res.json().error).toBe('Session expired');
    await app.close();
  });

  it('returns 200 when session is valid', async () => {
    const expiresAt = new Date(Date.now() + 60_000);
    const prismaMock = {
      apiSession: {
        findUnique: vi.fn(async () => ({
          id: '11111111-1111-4111-8111-111111111111',
          pubkey: '0x' + 'aa'.repeat(32),
          origin: 'https://example.com:443',
          scopesJson: [{ type: 'auth.sign_challenge' }],
          createdAt: new Date(),
          expiresAt,
        })),
      },
    };

    vi.doMock('../prisma.js', () => ({ prisma: prismaMock }));
    const { registerMeRoutes } = await import('./me.js');

    const app = fastify({ logger: false });
    await app.register((await import('@fastify/cookie')).default, { secret: 'test' });
    await registerMeRoutes(app);

    const res = await app.inject({
      method: 'GET',
      url: '/me',
      headers: { authorization: 'Bearer 11111111-1111-4111-8111-111111111111' },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({
      ok: true,
      sessionId: '11111111-1111-4111-8111-111111111111',
      origin: 'https://example.com:443',
    });
    await app.close();
  });
});
