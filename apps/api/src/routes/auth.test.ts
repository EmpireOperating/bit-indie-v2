import fastify from 'fastify';
import { randomBytes } from 'node:crypto';
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { sha256 } from '@noble/hashes/sha256';
import { schnorr } from '@noble/secp256k1';

function canonicalJsonStringify(obj: Record<string, unknown>): string {
  const keys = Object.keys(obj).sort();
  const out: Record<string, unknown> = {};
  for (const k of keys) out[k] = obj[k];
  return JSON.stringify(out);
}

function sha256Hex(input: string): string {
  const digest = sha256(new TextEncoder().encode(input));
  return `0x${Buffer.from(digest).toString('hex')}`;
}

describe('auth routes', () => {
  beforeEach(() => {
    vi.resetModules();
    delete process.env.SESSION_TTL_SECONDS;
  });

  it('POST /auth/challenge rejects origin with path', async () => {
    const prismaMock = {
      authChallenge: { create: vi.fn(async () => null) },
    };
    vi.doMock('../prisma.js', () => ({ prisma: prismaMock }));
    const { registerAuthRoutes } = await import('./auth.js');

    const app = fastify({ logger: false });
    await registerAuthRoutes(app);

    const res = await app.inject({
      method: 'POST',
      url: '/auth/challenge',
      payload: { origin: 'https://example.com/path' },
    });

    expect(res.statusCode).toBe(400);
    expect(res.json().error).toContain('must not include path');
    expect(prismaMock.authChallenge.create).not.toHaveBeenCalled();
    await app.close();
  });

  it('POST /auth/session rejects too many requested scopes', async () => {
    const prismaMock = {
      authChallenge: { findUnique: vi.fn(async () => null) },
    };
    vi.doMock('../prisma.js', () => ({ prisma: prismaMock }));
    const { registerAuthRoutes } = await import('./auth.js');

    const app = fastify({ logger: false });
    await registerAuthRoutes(app);

    const res = await app.inject({
      method: 'POST',
      url: '/auth/session',
      payload: {
        origin: 'https://example.com',
        pubkey: '0x' + '11'.repeat(32),
        signature: '0x' + '22'.repeat(64),
        challenge: {
          v: 1,
          origin: 'https://example.com:443',
          nonce: '0x' + '33'.repeat(32),
          timestamp: Math.floor(Date.now() / 1000),
        },
        requestedScopes: Array.from({ length: 129 }, () => ({ type: 'x' })),
      },
    });

    expect(res.statusCode).toBe(400);
    expect(res.json().error).toBe('Invalid request body');
    await app.close();
  });

  it('POST /auth/session returns 409 on challenge timestamp mismatch', async () => {
    const now = Math.floor(Date.now() / 1000);
    const pending = {
      id: 'challenge-id',
      origin: 'https://example.com:443',
      nonce: '0x' + '44'.repeat(32),
      timestamp: now - 1,
      expiresAt: new Date(Date.now() + 60_000),
    };

    const prismaMock = {
      authChallenge: {
        findUnique: vi.fn(async () => pending),
        delete: vi.fn(async () => null),
      },
      apiSession: { create: vi.fn(async () => null) },
      user: { upsert: vi.fn(async () => null) },
    };
    vi.doMock('../prisma.js', () => ({ prisma: prismaMock }));
    const { registerAuthRoutes } = await import('./auth.js');

    const app = fastify({ logger: false });
    await registerAuthRoutes(app);

    const res = await app.inject({
      method: 'POST',
      url: '/auth/session',
      payload: {
        origin: 'https://example.com',
        pubkey: '0x' + '11'.repeat(32),
        signature: '0x' + '22'.repeat(64),
        challenge: {
          v: 1,
          origin: pending.origin,
          nonce: pending.nonce,
          timestamp: now,
        },
      },
    });

    expect(res.statusCode).toBe(409);
    expect(res.json().error).toBe('Challenge mismatch');
    expect(prismaMock.authChallenge.delete).not.toHaveBeenCalled();
    await app.close();
  });

  it('POST /auth/session uses default TTL when env ttl is invalid', async () => {
    process.env.SESSION_TTL_SECONDS = 'wat';

    const priv = randomBytes(32);
    const pubkey = `0x${Buffer.from(schnorr.getPublicKey(priv)).toString('hex')}`;
    const challenge = {
      v: 1,
      origin: 'https://example.com:443',
      nonce: '0x' + randomBytes(32).toString('hex'),
      timestamp: Math.floor(Date.now() / 1000),
    };

    const hashHex = sha256Hex(canonicalJsonStringify(challenge));
    const sig = await schnorr.sign(Buffer.from(hashHex.slice(2), 'hex'), priv);
    const signature = `0x${Buffer.from(sig).toString('hex')}`;

    const pending = {
      id: 'challenge-id',
      origin: challenge.origin,
      nonce: challenge.nonce,
      timestamp: challenge.timestamp,
      expiresAt: new Date(Date.now() + 60_000),
    };

    const createdAt = new Date();
    const prismaMock = {
      authChallenge: {
        findUnique: vi.fn(async () => pending),
        delete: vi.fn(async () => null),
      },
      apiSession: {
        create: vi.fn(async ({ data }: any) => ({
          id: '11111111-1111-4111-8111-111111111111',
          pubkey: data.pubkey,
          origin: data.origin,
          scopesJson: data.scopesJson,
          expiresAt: data.expiresAt,
          createdAt,
        })),
      },
      user: { upsert: vi.fn(async () => null) },
    };

    vi.doMock('../prisma.js', () => ({ prisma: prismaMock }));
    const { registerAuthRoutes } = await import('./auth.js');

    const app = fastify({ logger: false });
    await app.register((await import('@fastify/cookie')).default, { secret: 'test' });
    await registerAuthRoutes(app);

    const start = Date.now();
    const res = await app.inject({
      method: 'POST',
      url: '/auth/session',
      payload: {
        origin: 'https://example.com',
        pubkey,
        signature,
        challenge,
      },
    });

    expect(res.statusCode).toBe(201);
    const body = res.json();
    expect(body.ok).toBe(true);
    // default ttl = 3600s when env value is invalid
    expect(body.session.expires_at).toBeGreaterThanOrEqual(Math.floor((start + 3590_000) / 1000));
    expect(body.session.expires_at).toBeLessThanOrEqual(Math.floor((start + 3610_000) / 1000));

    await app.close();
  });

  it('POST /auth/session floors decimal ttl seconds', async () => {
    process.env.SESSION_TTL_SECONDS = '12.9';

    const priv = randomBytes(32);
    const pubkey = `0x${Buffer.from(schnorr.getPublicKey(priv)).toString('hex')}`;
    const challenge = {
      v: 1,
      origin: 'https://example.com:443',
      nonce: '0x' + randomBytes(32).toString('hex'),
      timestamp: Math.floor(Date.now() / 1000),
    };

    const hashHex = sha256Hex(canonicalJsonStringify(challenge));
    const sig = await schnorr.sign(Buffer.from(hashHex.slice(2), 'hex'), priv);
    const signature = `0x${Buffer.from(sig).toString('hex')}`;

    const pending = {
      id: 'challenge-id',
      origin: challenge.origin,
      nonce: challenge.nonce,
      timestamp: challenge.timestamp,
      expiresAt: new Date(Date.now() + 60_000),
    };

    const createdAt = new Date();
    const prismaMock = {
      authChallenge: {
        findUnique: vi.fn(async () => pending),
        delete: vi.fn(async () => null),
      },
      apiSession: {
        create: vi.fn(async ({ data }: any) => ({
          id: '11111111-1111-4111-8111-111111111111',
          pubkey: data.pubkey,
          origin: data.origin,
          scopesJson: data.scopesJson,
          expiresAt: data.expiresAt,
          createdAt,
        })),
      },
      user: { upsert: vi.fn(async () => null) },
    };

    vi.doMock('../prisma.js', () => ({ prisma: prismaMock }));
    const { registerAuthRoutes } = await import('./auth.js');

    const app = fastify({ logger: false });
    await app.register((await import('@fastify/cookie')).default, { secret: 'test' });
    await registerAuthRoutes(app);

    const start = Date.now();
    const res = await app.inject({
      method: 'POST',
      url: '/auth/session',
      payload: {
        origin: 'https://example.com',
        pubkey,
        signature,
        challenge,
      },
    });

    expect(res.statusCode).toBe(201);
    const body = res.json();
    expect(body.session.expires_at).toBeGreaterThanOrEqual(Math.floor((start + 11_000) / 1000));
    expect(body.session.expires_at).toBeLessThanOrEqual(Math.floor((start + 13_000) / 1000));

    await app.close();
  });

  it('POST /auth/session still returns expired when expired challenge cleanup fails', async () => {
    const prismaMock = {
      authChallenge: {
        findUnique: vi.fn(async () => ({
          id: 'challenge-id',
          origin: 'https://example.com:443',
          nonce: '0x' + '44'.repeat(32),
          timestamp: Math.floor(Date.now() / 1000),
          expiresAt: new Date(Date.now() - 1_000),
        })),
        delete: vi.fn(async () => {
          throw new Error('delete failed');
        }),
      },
      apiSession: { create: vi.fn(async () => null) },
      user: { upsert: vi.fn(async () => null) },
    };
    vi.doMock('../prisma.js', () => ({ prisma: prismaMock }));
    const { registerAuthRoutes } = await import('./auth.js');

    const app = fastify({ logger: false });
    await registerAuthRoutes(app);

    const res = await app.inject({
      method: 'POST',
      url: '/auth/session',
      payload: {
        origin: 'https://example.com',
        pubkey: '0x' + '11'.repeat(32),
        signature: '0x' + '22'.repeat(64),
        challenge: {
          v: 1,
          origin: 'https://example.com:443',
          nonce: '0x' + '44'.repeat(32),
          timestamp: Math.floor(Date.now() / 1000),
        },
      },
    });

    expect(res.statusCode).toBe(409);
    expect(res.json().error).toBe('Challenge expired');
    expect(prismaMock.authChallenge.delete).toHaveBeenCalledOnce();
    await app.close();
  });

  it('POST /auth/challenge returns 503 with consistent body when store is unavailable', async () => {
    const prismaMock = {
      authChallenge: {
        create: vi.fn(async () => {
          throw new Error('db down');
        }),
      },
    };
    vi.doMock('../prisma.js', () => ({ prisma: prismaMock }));
    const { registerAuthRoutes } = await import('./auth.js');

    const app = fastify({ logger: false });
    await registerAuthRoutes(app);

    const res = await app.inject({
      method: 'POST',
      url: '/auth/challenge',
      payload: { origin: 'https://example.com' },
    });

    expect(res.statusCode).toBe(503);
    expect(res.json()).toEqual({ ok: false, error: 'Challenge store unavailable' });
    await app.close();
  });
});
