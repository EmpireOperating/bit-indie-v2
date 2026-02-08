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
    expect(body.contractVersion).toBe('auth-contract-v3');
    expect(body.headed?.qr?.approve).toBe('/auth/qr/approve');
    expect(body.headless?.challenge).toBe('/auth/agent/challenge');
    expect(body.headless?.verifyHash).toBe('/auth/agent/verify-hash');
    expect(body.headless?.tokenType).toBe('Bearer');
    expect(body.headed?.qr?.statusValues).toContain('approved');
    expect(body.headed?.qr?.lightningUriTemplate).toContain('lightning:bitindie-auth-v1');
    expect(body.headed?.qr?.challengeTtlSeconds).toBe(300);
    expect(body.headed?.qr?.pollIntervalMs).toBe(1500);
    expect(body.headed?.qr?.handoff?.cookieName).toBe('bi_session');
    expect(body.headed?.qr?.exampleEndpoint).toBe('/auth/qr/approve/example');
    expect(body.headed?.qr?.constructionStatus).toBe('/auth/qr/construction/status');
    expect(body.headed?.qr?.loginManifest).toBe('/auth/qr/login/manifest');
    expect(body.headless?.signatureEncoding).toBe('0x-hex-64-byte');
    expect(body.headless?.challengeHash?.algorithm).toBe('sha256');
    expect(body.headless?.optionalChallengeHashField).toBe('challengeHash');
    expect(body.headless?.loginManifest).toBe('/auth/agent/login/manifest');
    expect(body.constraints?.challengeTtlSeconds).toBe(300);
    expect(body.constraints?.sessionTtlSeconds).toBe(3600);
    expect(body.constraints?.maxChallengeFutureSkewSeconds).toBe(60);

    await app.close();
  });


  it('GET /auth/login/surfaces returns unified headed + headless login-to-entitlement map', async () => {
    const prismaMock = {
      authChallenge: { create: vi.fn(async () => null) },
    };
    vi.doMock('../prisma.js', () => ({ prisma: prismaMock }));
    const { registerAuthRoutes } = await import('./auth.js');

    const app = fastify({ logger: false });
    await registerAuthRoutes(app);

    const res = await app.inject({
      method: 'GET',
      url: '/auth/login/surfaces',
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.ok).toBe(true);
    expect(body.objective).toContain('human + agent');
    expect(body.surfaces.headed.loginManifest).toBe('/auth/qr/login/manifest');
    expect(body.surfaces.headed.sessionContracts).toBe('/auth/qr/session/contracts');
    expect(body.surfaces.headed.example).toBe('/auth/qr/approve/example');
    expect(body.surfaces.headed.entitlementModes.tokenizedAccess).toContain('surface=headed&mode=tokenized_access');
    expect(body.surfaces.headless.loginManifest).toBe('/auth/agent/login/manifest');
    expect(body.surfaces.headless.verifyHash).toBe('/auth/agent/verify-hash');
    expect(body.surfaces.headless.example).toBe('/auth/agent/signed-challenge/example');
    expect(body.surfaces.headless.tokenHandoff.tokenField).toBe('accessToken');
    expect(body.sharedConstraints.challengeTtlSeconds).toBe(300);

    await app.close();
  });

  it('GET /auth/session/contracts/surfaces returns first-class headed + headless session contract map', async () => {
    const prismaMock = {
      authChallenge: { create: vi.fn(async () => null) },
    };
    vi.doMock('../prisma.js', () => ({ prisma: prismaMock }));
    const { registerAuthRoutes } = await import('./auth.js');

    const app = fastify({ logger: false });
    await registerAuthRoutes(app);

    const res = await app.inject({
      method: 'GET',
      url: '/auth/session/contracts/surfaces',
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.ok).toBe(true);
    expect(body.surfaces.headed.sessionContracts).toBe('/auth/qr/session/contracts');
    expect(body.surfaces.headed.statusContracts).toBe('/auth/qr/status/contracts');
    expect(body.surfaces.headed.entitlementBridge.tokenized).toContain('surface=headed&mode=tokenized_access');
    expect(body.surfaces.headless.challengeContracts).toBe('/auth/agent/challenge/contracts');
    expect(body.surfaces.headless.sessionContracts).toBe('/auth/agent/session/contracts');
    expect(body.surfaces.headless.handoff.tokenField).toBe('accessToken');
    expect(body.surfaces.headless.entitlementBridge.tokenized).toContain('surface=headless&mode=tokenized_access');
    expect(body.shared.challengeTtlSeconds).toBe(300);

    await app.close();
  });

  it('GET /auth/login/construction/manifest returns implementation-ready human + agent construction lanes', async () => {
    const prismaMock = {
      authChallenge: { create: vi.fn(async () => null) },
    };
    vi.doMock('../prisma.js', () => ({ prisma: prismaMock }));
    const { registerAuthRoutes } = await import('./auth.js');

    const app = fastify({ logger: false });
    await registerAuthRoutes(app);

    const res = await app.inject({
      method: 'GET',
      url: '/auth/login/construction/manifest',
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.ok).toBe(true);
    expect(body.mode).toBe('auth-store-construction');
    expect(body.lanes.headedHumanLightning.phase).toBe('A');
    expect(body.lanes.headedHumanLightning.steps).toContain('/auth/qr/approve');
    expect(body.lanes.headlessSignedChallenge.phase).toBe('B');
    expect(body.lanes.headlessSignedChallenge.steps).toContain('/auth/agent/verify-hash');
    expect(body.entitlementBridge.headed.tokenized).toContain('surface=headed&mode=tokenized_access');
    expect(body.entitlementBridge.headless.tokenized).toContain('surface=headless&mode=tokenized_access');

    await app.close();
  });

  it('GET /auth/entitlement/construction/contracts returns lane-ordered auth-to-entitlement construction map', async () => {
    const prismaMock = {
      authChallenge: { create: vi.fn(async () => null) },
    };
    vi.doMock('../prisma.js', () => ({ prisma: prismaMock }));
    const { registerAuthRoutes } = await import('./auth.js');

    const app = fastify({ logger: false });
    await registerAuthRoutes(app);

    const res = await app.inject({
      method: 'GET',
      url: '/auth/entitlement/construction/contracts',
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.ok).toBe(true);
    expect(body.mode).toBe('auth-store-construction');
    expect(body.laneOrder[0]).toContain('A: headed lightning login');
    expect(body.lanes.headed.loginManifest).toBe('/auth/qr/login/manifest');
    expect(body.lanes.headed.entitlement.directDownload).toContain('surface=headed&mode=direct_download');
    expect(body.lanes.headless.loginManifest).toBe('/auth/agent/login/manifest');
    expect(body.lanes.headless.entitlement.tokenizedAccess).toContain('surface=headless&mode=tokenized_access');
    expect(body.storefront.scaffoldParallelManifest).toBe('/storefront/scaffold/parallel-lanes/manifest');

    await app.close();
  });


  it('GET /auth/storefront/construction/runtime returns runtime-backed auth/store construction map', async () => {
    const prismaMock = {
      authChallenge: { create: vi.fn(async () => null) },
    };
    vi.doMock('../prisma.js', () => ({ prisma: prismaMock }));
    const { registerAuthRoutes } = await import('./auth.js');

    const app = fastify({ logger: false });
    await registerAuthRoutes(app);

    const res = await app.inject({
      method: 'GET',
      url: '/auth/storefront/construction/runtime',
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.ok).toBe(true);
    expect(body.mode).toBe('auth-store-construction');
    expect(body.priorities.A.runtime.approve).toBe('/auth/qr/approve');
    expect(body.priorities.B.runtime.challenge).toBe('/auth/agent/challenge');
    expect(body.priorities.C.runtime.download).toBe('/releases/:releaseId/download');
    expect(body.priorities.D.runtime.headless).toContain('surface=headless');
    expect(body.mergeGates.tests).toBe('npm test --silent');

    await app.close();
  });

  it('GET /auth/storefront/construction/runtime/session-lifecycle returns lifecycle + edge-handling map', async () => {
    const prismaMock = {
      authChallenge: { create: vi.fn(async () => null) },
    };
    vi.doMock('../prisma.js', () => ({ prisma: prismaMock }));
    const { registerAuthRoutes } = await import('./auth.js');

    const app = fastify({ logger: false });
    await registerAuthRoutes(app);

    const res = await app.inject({
      method: 'GET',
      url: '/auth/storefront/construction/runtime/session-lifecycle',
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.ok).toBe(true);
    expect(body.phases.issueChallenge.headed).toBe('/auth/qr/start');
    expect(body.phases.approveOrSign.headless).toBe('/auth/agent/session');
    expect(body.phases.consumeEntitlement.headlessTokenized).toContain('surface=headless&mode=tokenized_access');
    expect(body.edgeHandling.signatureInvalid).toContain('401');
    expect(body.mergeGates.tests).toBe('npm test --silent');

    await app.close();
  });


  it('GET /auth/qr/contracts returns first-class human lightning QR login contract', async () => {
    const prismaMock = {
      authChallenge: { create: vi.fn(async () => null) },
    };
    vi.doMock('../prisma.js', () => ({ prisma: prismaMock }));
    const { registerAuthRoutes } = await import('./auth.js');

    const app = fastify({ logger: false });
    await registerAuthRoutes(app);

    const res = await app.inject({
      method: 'GET',
      url: '/auth/qr/contracts',
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.ok).toBe(true);
    expect(body.contractVersion).toBe('auth-contract-v3');
    expect(body.authFlow).toBe('lightning_qr_approve_v1');
    expect(body.start).toBe('/auth/qr/start');
    expect(body.approve).toBe('/auth/qr/approve');
    expect(body.statusValues).toContain('approved');
    expect(body.lightningUriTemplate).toContain('lightning:bitindie-auth-v1?challenge=');
    expect(body.handoff.cookieName).toBe('bi_session');
    expect(body.exampleEndpoint).toBe('/auth/qr/approve/example');

    await app.close();
  });

  it('GET /auth/qr/construction/status returns phase-A implementation readiness for human lightning login', async () => {
    const prismaMock = {
      authChallenge: { create: vi.fn(async () => null) },
    };
    vi.doMock('../prisma.js', () => ({ prisma: prismaMock }));
    const { registerAuthRoutes } = await import('./auth.js');

    const app = fastify({ logger: false });
    await registerAuthRoutes(app);

    const res = await app.inject({
      method: 'GET',
      url: '/auth/qr/construction/status',
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.ok).toBe(true);
    expect(body.phase).toBe('A');
    expect(body.authFlow).toBe('lightning_qr_approve_v1');
    expect(body.readiness.ready).toBe(true);
    expect(body.readiness.challengeIssue).toBe('/auth/qr/start');
    expect(body.readiness.sessionContracts).toBe('/auth/qr/session/contracts');
    expect(body.handoff.cookieName).toBe('bi_session');
    expect(body.nextPhase.endpoint).toBe('/auth/agent/construction/status');

    await app.close();
  });

  it('GET /auth/qr/approve/example returns deterministic human QR approval walkthrough', async () => {
    const prismaMock = {
      authChallenge: { create: vi.fn(async () => null) },
    };
    vi.doMock('../prisma.js', () => ({ prisma: prismaMock }));
    const { registerAuthRoutes } = await import('./auth.js');

    const app = fastify({ logger: false });
    await registerAuthRoutes(app);

    const res = await app.inject({
      method: 'GET',
      url: '/auth/qr/approve/example',
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.ok).toBe(true);
    expect(body.authFlow).toBe('lightning_qr_approve_v1');
    expect(body.steps[0].endpoint).toBe('/auth/qr/start');
    expect(body.steps[2].endpoint).toBe('/auth/qr/approve');
    expect(body.steps[3].endpoint).toContain('/auth/qr/status/');
    expect(body.steps[4].endpoint).toContain('surface=headed&mode=tokenized_access');

    await app.close();
  });

  it('GET /auth/qr/login/manifest returns deterministic headed login contract manifest', async () => {
    const prismaMock = {
      authChallenge: { create: vi.fn(async () => null) },
    };
    vi.doMock('../prisma.js', () => ({ prisma: prismaMock }));
    const { registerAuthRoutes } = await import('./auth.js');

    const app = fastify({ logger: false });
    await registerAuthRoutes(app);

    const res = await app.inject({
      method: 'GET',
      url: '/auth/qr/login/manifest',
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.ok).toBe(true);
    expect(body.authFlow).toBe('lightning_qr_approve_v1');
    expect(body.endpoints.start).toBe('/auth/qr/start');
    expect(body.endpoints.status).toContain('/auth/qr/status/');
    expect(body.endpoints.sessionContracts).toBe('/auth/qr/session/contracts');
    expect(body.tokenHandoff.cookieName).toBe('bi_session');
    expect(body.entitlementBridge.headedTokenized).toContain('surface=headed&mode=tokenized_access');

    await app.close();
  });

  it('GET /auth/qr/session/contracts returns first-class human QR approval session contract', async () => {
    const prismaMock = {
      authChallenge: { create: vi.fn(async () => null) },
    };
    vi.doMock('../prisma.js', () => ({ prisma: prismaMock }));
    const { registerAuthRoutes } = await import('./auth.js');

    const app = fastify({ logger: false });
    await registerAuthRoutes(app);

    const res = await app.inject({
      method: 'GET',
      url: '/auth/qr/session/contracts',
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.ok).toBe(true);
    expect(body.endpoint).toBe('/auth/qr/approve');
    expect(body.method).toBe('POST');
    expect(body.handoff.cookieName).toBe('bi_session');
    expect(body.entitlementBridge.headedTokenizedPath).toContain('surface=headed&mode=tokenized_access');

    await app.close();
  });

  it('GET /auth/qr/status/contracts returns explicit poll-status contract for human lightning login', async () => {
    const prismaMock = {
      authChallenge: { create: vi.fn(async () => null) },
    };
    vi.doMock('../prisma.js', () => ({ prisma: prismaMock }));
    const { registerAuthRoutes } = await import('./auth.js');

    const app = fastify({ logger: false });
    await registerAuthRoutes(app);

    const res = await app.inject({
      method: 'GET',
      url: '/auth/qr/status/contracts',
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.ok).toBe(true);
    expect(body.endpoint).toBe('/auth/qr/status/:nonce?origin=<origin>');
    expect(body.statuses.pending.pollAfterMs).toBe(1500);
    expect(body.statuses.approved.handoff.cookieName).toBe('bi_session');
    expect(body.usage.approveEndpoint).toBe('/auth/qr/approve');

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
    expect(body.contractVersion).toBe('auth-contract-v3');
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

  it('GET /auth/agent/login/manifest returns deterministic headless signed-challenge manifest', async () => {
    const prismaMock = {
      authChallenge: { create: vi.fn(async () => null) },
    };
    vi.doMock('../prisma.js', () => ({ prisma: prismaMock }));
    const { registerAuthRoutes } = await import('./auth.js');

    const app = fastify({ logger: false });
    await registerAuthRoutes(app);

    const res = await app.inject({
      method: 'GET',
      url: '/auth/agent/login/manifest',
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.ok).toBe(true);
    expect(body.authFlow).toBe('signed_challenge_v1');
    expect(body.endpoints.challenge).toBe('/auth/agent/challenge');
    expect(body.endpoints.verifyHash).toBe('/auth/agent/verify-hash');
    expect(body.tokenHandoff.tokenField).toBe('accessToken');
    expect(body.entitlementBridge.headlessTokenized).toContain('surface=headless&mode=tokenized_access');

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
    expect(body.contractVersion).toBe('auth-contract-v3');
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
    expect(body.verify.contracts).toBe('/auth/agent/contracts');
    expect(body.verify.challengeHash).toBe('/auth/agent/verify-hash');
    await app.close();
  });


  it('GET /auth/agent/session/contracts returns first-class headless session contract', async () => {
    const prismaMock = {
      authChallenge: { create: vi.fn(async () => null) },
    };
    vi.doMock('../prisma.js', () => ({ prisma: prismaMock }));
    const { registerAuthRoutes } = await import('./auth.js');

    const app = fastify({ logger: false });
    await registerAuthRoutes(app);

    const res = await app.inject({
      method: 'GET',
      url: '/auth/agent/session/contracts',
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.ok).toBe(true);
    expect(body.endpoint).toBe('/auth/agent/session');
    expect(body.method).toBe('POST');
    expect(body.response.tokenField).toBe('accessToken');
    expect(body.entitlementBridge.tokenizedAccessPath).toContain('surface=headless&mode=tokenized_access');

    await app.close();
  });

  it('GET /auth/agent/challenge/contracts returns explicit challenge issuance contract for agents', async () => {
    const prismaMock = {
      authChallenge: { create: vi.fn(async () => null) },
    };
    vi.doMock('../prisma.js', () => ({ prisma: prismaMock }));
    const { registerAuthRoutes } = await import('./auth.js');

    const app = fastify({ logger: false });
    await registerAuthRoutes(app);

    const res = await app.inject({
      method: 'GET',
      url: '/auth/agent/challenge/contracts',
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.ok).toBe(true);
    expect(body.endpoint).toBe('/auth/agent/challenge');
    expect(body.method).toBe('POST');
    expect(body.response.submitEndpoint).toBe('/auth/agent/session');
    expect(body.challengeHash.verifyEndpoint).toBe('/auth/agent/verify-hash');
    expect(body.entitlementBridge.tokenizedAccessPath).toContain('surface=headless&mode=tokenized_access');

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
    expect(body.contractVersion).toBe('auth-contract-v3');
    expect(body.challengeEndpoint).toBe('/auth/agent/challenge');
    expect(body.verifyHashEndpoint).toBe('/auth/agent/verify-hash');
    expect(body.sessionEndpoint).toBe('/auth/agent/session');
    expect(body.signer.scheme).toBe('schnorr');
    expect(body.challengeHash.optionalField).toBe('challengeHash');
    expect(body.entitlementBridge.usage).toContain('/releases/:releaseId/download');
    expect(body.constructionStatus).toBe('/auth/agent/construction/status');
    expect(body.exampleEndpoint).toBe('/auth/agent/signed-challenge/example');

    await app.close();
  });

  it('GET /auth/agent/construction/status returns phase-B readiness for headless signed-challenge auth', async () => {
    const prismaMock = {
      authChallenge: { create: vi.fn(async () => null) },
    };
    vi.doMock('../prisma.js', () => ({ prisma: prismaMock }));
    const { registerAuthRoutes } = await import('./auth.js');

    const app = fastify({ logger: false });
    await registerAuthRoutes(app);

    const res = await app.inject({
      method: 'GET',
      url: '/auth/agent/construction/status',
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.ok).toBe(true);
    expect(body.phase).toBe('B');
    expect(body.authFlow).toBe('signed_challenge_v1');
    expect(body.readiness.ready).toBe(true);
    expect(body.readiness.hashPreflight).toBe('/auth/agent/verify-hash');
    expect(body.handoff.tokenType).toBe('Bearer');
    expect(body.previousPhase.endpoint).toBe('/auth/qr/construction/status');
    expect(body.nextPhase.endpoint).toBe('/storefront/download/contracts');

    await app.close();
  });

  it('GET /auth/agent/signed-challenge/example returns deterministic headless auth + entitlement walkthrough', async () => {
    const prismaMock = {
      authChallenge: { create: vi.fn(async () => null) },
    };
    vi.doMock('../prisma.js', () => ({ prisma: prismaMock }));
    const { registerAuthRoutes } = await import('./auth.js');

    const app = fastify({ logger: false });
    await registerAuthRoutes(app);

    const res = await app.inject({
      method: 'GET',
      url: '/auth/agent/signed-challenge/example',
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.ok).toBe(true);
    expect(body.authFlow).toBe('signed_challenge_v1');
    expect(body.steps).toHaveLength(5);
    expect(body.steps[0].endpoint).toBe('/auth/agent/challenge');
    expect(body.steps[2].endpoint).toBe('/auth/agent/session');
    expect(body.steps[3].endpoint).toContain('/storefront/entitlement/path?surface=headless&mode=tokenized_access');
    expect(body.steps[4].authorizationHeader).toBe('Bearer <accessToken>');

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

  it('POST /auth/agent/verify-hash validates optional challengeHash preflight for agents', async () => {
    const prismaMock = {
      authChallenge: { create: vi.fn(async () => null) },
    };
    vi.doMock('../prisma.js', () => ({ prisma: prismaMock }));
    const { registerAuthRoutes } = await import('./auth.js');

    const app = fastify({ logger: false });
    await registerAuthRoutes(app);

    const challenge = {
      v: 1,
      origin: 'https://example.com:443',
      nonce: '0x' + randomBytes(32).toString('hex'),
      timestamp: Math.floor(Date.now() / 1000),
    };
    const challengeHash = sha256Hex(canonicalJsonStringify(challenge));

    const okRes = await app.inject({
      method: 'POST',
      url: '/auth/agent/verify-hash',
      payload: { challenge, challengeHash },
    });
    expect(okRes.statusCode).toBe(200);
    expect(okRes.json().matches).toBe(true);

    const badRes = await app.inject({
      method: 'POST',
      url: '/auth/agent/verify-hash',
      payload: { challenge, challengeHash: `0x${'00'.repeat(32)}` },
    });
    expect(badRes.statusCode).toBe(200);
    expect(badRes.json().matches).toBe(false);

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
