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
    delete process.env.AUTH_CHALLENGE_TTL_SECONDS;
  });

  it('GET /auth/contracts returns headed + headless auth lanes', async () => {
    const prismaMock = {
      authChallenge: { create: vi.fn(async () => null) },
    };
    vi.doMock('../prisma.js', () => ({ prisma: prismaMock }));
    const { registerAuthRoutes } = await import('./auth.js');

    const app = fastify({ logger: false });
    await registerAuthRoutes(app);

    const res = await app.inject({
      method: 'GET',
      url: '/auth/contracts',
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.ok).toBe(true);
    expect(body.headed?.qr?.approve).toBe('/auth/qr/approve');
    expect(body.headless?.challenge).toBe('/auth/agent/challenge');
    expect(body.headless?.tokenType).toBe('Bearer');
    expect(body.headed?.qr?.statusValues).toContain('approved');
    expect(body.headed?.qr?.lightningUriTemplate).toContain('lightning:bitindie-auth-v1');
    expect(body.headed?.qr?.challengeTtlSeconds).toBe(300);
    expect(body.headed?.qr?.pollIntervalMs).toBe(1500);
    expect(body.headed?.qr?.handoff?.cookieName).toBe('bi_session');
    expect(body.headless?.signatureEncoding).toBe('0x-hex-64-byte');
    expect(body.headless?.challengeHash?.algorithm).toBe('sha256');
    expect(body.headless?.optionalChallengeHashField).toBe('challengeHash');
    expect(body.constraints?.challengeTtlSeconds).toBe(300);
    expect(body.constraints?.sessionTtlSeconds).toBe(3600);
    expect(body.constraints?.maxChallengeFutureSkewSeconds).toBe(60);

    await app.close();
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

  it('POST /auth/challenge uses AUTH_CHALLENGE_TTL_SECONDS when provided', async () => {
    process.env.AUTH_CHALLENGE_TTL_SECONDS = '42';

    const prismaMock = {
      authChallenge: {
        create: vi.fn(async () => null),
      },
    };

    vi.doMock('../prisma.js', () => ({ prisma: prismaMock }));
    const { registerAuthRoutes } = await import('./auth.js');

    const app = fastify({ logger: false });
    await registerAuthRoutes(app);

    const start = Date.now();
    const res = await app.inject({
      method: 'POST',
      url: '/auth/challenge',
      payload: { origin: 'https://example.com' },
    });

    expect(res.statusCode).toBe(200);
    expect(prismaMock.authChallenge.create).toHaveBeenCalledOnce();
    const expiresAt = prismaMock.authChallenge.create.mock.calls[0]?.[0]?.data?.expiresAt as Date;
    expect(expiresAt.getTime()).toBeGreaterThanOrEqual(start + 41_000);
    expect(expiresAt.getTime()).toBeLessThanOrEqual(start + 43_000);

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

  it('POST /auth/qr/start returns challenge + polling contract', async () => {
    const prismaMock = {
      authChallenge: {
        create: vi.fn(async () => null),
      },
    };
    vi.doMock('../prisma.js', () => ({ prisma: prismaMock }));
    const { registerAuthRoutes } = await import('./auth.js');

    const app = fastify({ logger: false });
    await registerAuthRoutes(app);

    const res = await app.inject({
      method: 'POST',
      url: '/auth/qr/start',
      payload: { origin: 'https://example.com' },
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.ok).toBe(true);
    expect(body.challenge.origin).toBe('https://example.com:443');
    expect(body.approve.endpoint).toBe('/auth/qr/approve');
    expect(body.approve.payloadContract.pubkey).toContain('32-byte');
    expect(body.poll.endpoint).toContain('/auth/qr/status/');
    expect(body.poll.intervalMs).toBe(1500);
    expect(body.poll.statusValues).toContain('pending');
    expect(body.challengeTtlSeconds).toBe(300);
    expect(body.expires_at).toBe(body.challenge.timestamp + 300);
    expect(body.qrPayload.type).toBe('bitindie-auth-v1');
    expect(body.lightningUri).toContain('lightning:bitindie-auth-v1?challenge=');

    await app.close();
  });

  it('GET /auth/qr/status returns poll interval hint while challenge is pending', async () => {
    const nonce = '0x' + randomBytes(32).toString('hex');
    const prismaMock = {
      authChallenge: {
        findUnique: vi.fn(async () => ({
          id: 'challenge-id',
          origin: 'https://example.com:443',
          nonce,
          timestamp: Math.floor(Date.now() / 1000),
          expiresAt: new Date(Date.now() + 60_000),
        })),
      },
    };

    vi.doMock('../prisma.js', () => ({ prisma: prismaMock }));
    const { registerAuthRoutes } = await import('./auth.js');

    const app = fastify({ logger: false });
    await registerAuthRoutes(app);

    const res = await app.inject({
      method: 'GET',
      url: `/auth/qr/status/${nonce}?origin=https://example.com`,
    });

    expect(res.statusCode).toBe(200);
    expect(res.json().status).toBe('pending');
    expect(res.json().pollAfterMs).toBe(1500);

    await app.close();
  });

  it('POST /auth/qr/approve creates session and sets cookie for browser login handoff', async () => {
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

    const createdAt = new Date();
    const prismaMock = {
      authChallenge: {
        findUnique: vi.fn(async () => ({
          id: 'challenge-id',
          origin: challenge.origin,
          nonce: challenge.nonce,
          timestamp: challenge.timestamp,
          expiresAt: new Date(Date.now() + 60_000),
        })),
        delete: vi.fn(async () => null),
      },
      apiSession: {
        create: vi.fn(async ({ data }: any) => ({
          id: '22222222-2222-4222-8222-222222222222',
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

    const res = await app.inject({
      method: 'POST',
      url: '/auth/qr/approve',
      payload: {
        origin: 'https://example.com',
        pubkey,
        signature,
        challenge,
      },
    });

    expect(res.statusCode).toBe(201);
    expect(res.headers['set-cookie']).toContain('bi_session=22222222-2222-4222-8222-222222222222');
    expect(res.json().session?.id).toBe('22222222-2222-4222-8222-222222222222');
    await app.close();
  });

  it('POST /auth/agent/challenge returns signed-challenge contract for headless agents', async () => {
    const prismaMock = {
      authChallenge: {
        create: vi.fn(async () => null),
      },
    };
    vi.doMock('../prisma.js', () => ({ prisma: prismaMock }));
    const { registerAuthRoutes } = await import('./auth.js');

    const app = fastify({ logger: false });
    await registerAuthRoutes(app);

    const res = await app.inject({
      method: 'POST',
      url: '/auth/agent/challenge',
      payload: { origin: 'https://example.com' },
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.ok).toBe(true);
    expect(body.challenge.origin).toBe('https://example.com:443');
    expect(body.submit.endpoint).toBe('/auth/agent/session');
    expect(body.submit.payloadContract.signature).toContain('64-byte');
    expect(body.submit.payloadContract.challengeHash).toContain('optional');
    expect(body.authFlow).toBe('signed_challenge_v1');
    expect(body.challengeTtlSeconds).toBe(300);
    expect(body.expires_at).toBe(body.challenge.timestamp + 300);
    expect(body.challengeHashPreview).toMatch(/^0x[0-9a-f]{64}$/);
    expect(body.challengeHash.algorithm).toBe('sha256');
    expect(body.requestedScopes.maxItems).toBe(128);
    expect(body.verify.endpoint).toBe('/auth/agent/contracts');
    await app.close();
  });

  it('GET /auth/agent/contracts returns first-class signed-challenge contract surface', async () => {
    const prismaMock = {
      authChallenge: { create: vi.fn(async () => null) },
    };
    vi.doMock('../prisma.js', () => ({ prisma: prismaMock }));
    const { registerAuthRoutes } = await import('./auth.js');

    const app = fastify({ logger: false });
    await registerAuthRoutes(app);

    const res = await app.inject({
      method: 'GET',
      url: '/auth/agent/contracts',
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.ok).toBe(true);
    expect(body.challengeEndpoint).toBe('/auth/agent/challenge');
    expect(body.sessionEndpoint).toBe('/auth/agent/session');
    expect(body.signer.scheme).toBe('schnorr');
    expect(body.challengeHash.optionalField).toBe('challengeHash');
    expect(body.entitlementBridge.usage).toContain('/releases/:releaseId/download');

    await app.close();
  });

  it('GET /auth/qr/status rejects approved cache replay across origin', async () => {
    const now = Math.floor(Date.now() / 1000);
    const nonce = '0x' + randomBytes(32).toString('hex');
    const challenge = {
      v: 1,
      origin: 'https://example.com:443',
      nonce,
      timestamp: now,
    };

    const priv = randomBytes(32);
    const pubkey = `0x${Buffer.from(schnorr.getPublicKey(priv)).toString('hex')}`;
    const hashHex = sha256Hex(canonicalJsonStringify(challenge));
    const sig = await schnorr.sign(Buffer.from(hashHex.slice(2), 'hex'), priv);
    const signature = `0x${Buffer.from(sig).toString('hex')}`;

    const createdAt = new Date();
    const prismaMock = {
      authChallenge: {
        findUnique: vi.fn(async () => ({
          id: 'challenge-id',
          origin: challenge.origin,
          nonce: challenge.nonce,
          timestamp: challenge.timestamp,
          expiresAt: new Date(Date.now() + 60_000),
        })),
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

    const approve = await app.inject({
      method: 'POST',
      url: '/auth/qr/approve',
      payload: {
        origin: 'https://example.com',
        pubkey,
        signature,
        challenge,
      },
    });
    expect(approve.statusCode).toBe(201);

    const approvedStatus = await app.inject({
      method: 'GET',
      url: `/auth/qr/status/${nonce}?origin=https://example.com`,
    });
    expect(approvedStatus.statusCode).toBe(200);
    expect(approvedStatus.json().status).toBe('approved');
    expect(approvedStatus.json().expires_at).toBeGreaterThan(approvedStatus.json().approved_at);
    expect(approvedStatus.json().handoff.cookieName).toBe('bi_session');

    const wrongOriginStatus = await app.inject({
      method: 'GET',
      url: `/auth/qr/status/${nonce}?origin=https://evil.example.com`,
    });
    expect(wrongOriginStatus.statusCode).toBe(409);
    expect(wrongOriginStatus.json().error).toBe('Challenge origin mismatch');

    await app.close();
  });

  it('POST /auth/agent/session rejects future challenge timestamp skew', async () => {
    const futureTs = Math.floor(Date.now() / 1000) + 120;
    const challenge = {
      v: 1,
      origin: 'https://example.com:443',
      nonce: '0x' + randomBytes(32).toString('hex'),
      timestamp: futureTs,
    };
    const priv = randomBytes(32);
    const pubkey = `0x${Buffer.from(schnorr.getPublicKey(priv)).toString('hex')}`;
    const hashHex = sha256Hex(canonicalJsonStringify(challenge));
    const sig = await schnorr.sign(Buffer.from(hashHex.slice(2), 'hex'), priv);
    const signature = `0x${Buffer.from(sig).toString('hex')}`;

    const prismaMock = {
      authChallenge: { findUnique: vi.fn(async () => null) },
      apiSession: { create: vi.fn(async () => null) },
      user: { upsert: vi.fn(async () => null) },
    };
    vi.doMock('../prisma.js', () => ({ prisma: prismaMock }));
    const { registerAuthRoutes } = await import('./auth.js');

    const app = fastify({ logger: false });
    await registerAuthRoutes(app);

    const res = await app.inject({
      method: 'POST',
      url: '/auth/agent/session',
      payload: {
        origin: 'https://example.com',
        pubkey,
        signature,
        challenge,
      },
    });

    expect(res.statusCode).toBe(409);
    expect(res.json().error).toBe('Challenge timestamp is in the future');
    expect(prismaMock.authChallenge.findUnique).not.toHaveBeenCalled();

    await app.close();
  });

  it('POST /auth/agent/session rejects mismatched optional challengeHash', async () => {
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

    const prismaMock = {
      authChallenge: {
        findUnique: vi.fn(async () => ({
          id: 'challenge-id',
          origin: challenge.origin,
          nonce: challenge.nonce,
          timestamp: challenge.timestamp,
          expiresAt: new Date(Date.now() + 60_000),
        })),
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
      url: '/auth/agent/session',
      payload: {
        origin: 'https://example.com',
        pubkey,
        signature,
        challenge,
        challengeHash: '0x' + 'ff'.repeat(32),
      },
    });

    expect(res.statusCode).toBe(409);
    expect(res.json().error).toBe('Challenge hash mismatch');
    expect(prismaMock.authChallenge.delete).not.toHaveBeenCalled();

    await app.close();
  });

  it('POST /auth/agent/session issues bearer token without cookie', async () => {
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

    const createdAt = new Date();
    const prismaMock = {
      authChallenge: {
        findUnique: vi.fn(async () => ({
          id: 'challenge-id',
          origin: challenge.origin,
          nonce: challenge.nonce,
          timestamp: challenge.timestamp,
          expiresAt: new Date(Date.now() + 60_000),
        })),
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

    const res = await app.inject({
      method: 'POST',
      url: '/auth/agent/session',
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
    expect(body.accessToken).toBe('11111111-1111-4111-8111-111111111111');
    expect(body.authFlow).toBe('signed_challenge_v1');
    expect(body.challengeVersion).toBe(1);
    expect(body.challengeHash).toBe(hashHex);
    expect(body.session).toBeUndefined();
    expect(res.headers['set-cookie']).toBeUndefined();

    await app.close();
  });

  it('POST /auth/agent/session normalizes requestedScopes before persistence', async () => {
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

    const createdAt = new Date();
    const prismaMock = {
      authChallenge: {
        findUnique: vi.fn(async () => ({
          id: 'challenge-id',
          origin: challenge.origin,
          nonce: challenge.nonce,
          timestamp: challenge.timestamp,
          expiresAt: new Date(Date.now() + 60_000),
        })),
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
    await registerAuthRoutes(app);

    const res = await app.inject({
      method: 'POST',
      url: '/auth/agent/session',
      payload: {
        origin: 'https://example.com',
        pubkey,
        signature,
        challenge,
        requestedScopes: [' Download ', 'download', 'STORE:READ', 'store:read'],
      },
    });

    expect(res.statusCode).toBe(201);
    expect(prismaMock.apiSession.create).toHaveBeenCalledOnce();
    expect(prismaMock.apiSession.create.mock.calls[0][0].data.scopesJson).toEqual([
      'download',
      'store:read',
    ]);

    await app.close();
  });
});
