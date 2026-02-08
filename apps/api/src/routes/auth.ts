import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { randomBytes } from 'node:crypto';
import { z } from 'zod';
import { sha256 } from '@noble/hashes/sha256';
import { schnorr } from '@noble/secp256k1';
import { prisma } from '../prisma.js';
import { fail, ok } from './httpResponses.js';

// --- Types / helpers (keep in sync with Embedded Signer contract) ---

const CHALLENGE_VERSION = 1;
const AUTH_CONTRACT_VERSION = 'auth-contract-v3';
const QR_APPROVAL_CACHE_TTL_MS = 5 * 60 * 1000;
const QR_POLL_INTERVAL_MS = 1500;
const DEFAULT_CHALLENGE_TTL_SECONDS = 5 * 60;
const MAX_CHALLENGE_FUTURE_SKEW_SECONDS = 60;

type QrApprovalRecord = {
  sessionId: string;
  pubkey: string;
  origin: string;
  expiresAtUnix: number;
  sessionExpiresAtUnix: number;
  approvedAtUnix: number;
};

const qrApprovalCache = new Map<string, QrApprovalRecord>();

function sendError(reply: FastifyReply, statusCode: number, error: string) {
  return reply.status(statusCode).send(fail(error));
}

function logAndSendError(
  req: FastifyRequest,
  reply: FastifyReply,
  statusCode: number,
  error: string,
  cause: unknown,
) {
  req.log.error({ err: cause }, error);
  return sendError(reply, statusCode, error);
}

function defaultPortForProtocol(protocol: string): number {
  return protocol === 'https:' ? 443 : 80;
}

function isHttpProtocol(protocol: string): boolean {
  return protocol === 'http:' || protocol === 'https:';
}

function isValidPort(port: number): boolean {
  return Number.isInteger(port) && port > 0 && port <= 65535;
}

function normalizeOrigin(origin: string): string {
  let url: URL;
  try {
    url = new URL(origin);
  } catch {
    throw new Error('Invalid origin');
  }

  if (url.pathname !== '/' || url.search || url.hash) {
    throw new Error('Origin must not include path, query, or fragment');
  }

  const protocol = url.protocol.toLowerCase();
  const hostname = url.hostname.toLowerCase();
  if (!isHttpProtocol(protocol)) {
    throw new Error('Origin protocol must be http or https');
  }

  const port = url.port ? Number(url.port) : defaultPortForProtocol(protocol);
  if (!isValidPort(port)) {
    throw new Error('Invalid origin port');
  }

  return `${protocol}//${hostname}:${port}`;
}

function isHex32(v: string): boolean {
  return /^0x[0-9a-fA-F]{64}$/.test(v);
}

function isHex64(v: string): boolean {
  return /^0x[0-9a-fA-F]{128}$/.test(v);
}

function canonicalJsonStringify(obj: unknown): string {
  if (obj == null || typeof obj !== 'object' || Array.isArray(obj)) {
    return JSON.stringify(obj);
  }
  const rec = obj as Record<string, unknown>;
  const keys = Object.keys(rec).sort();
  const out: Record<string, unknown> = {};
  for (const k of keys) out[k] = rec[k];
  return JSON.stringify(out);
}

function sha256Hex(input: string): string {
  const digest = sha256(new TextEncoder().encode(input));
  return `0x${Buffer.from(digest).toString('hex')}`;
}

function base64UrlEncodeJson(obj: unknown): string {
  return Buffer.from(JSON.stringify(obj), 'utf8').toString('base64url');
}

function buildLightningLoginUri(challenge: unknown): string {
  return `lightning:bitindie-auth-v1?challenge=${base64UrlEncodeJson(challenge)}`;
}

function cleanupQrApprovalCache() {
  const now = Math.floor(Date.now() / 1000);
  for (const [nonce, record] of qrApprovalCache.entries()) {
    if (record.expiresAtUnix <= now) {
      qrApprovalCache.delete(nonce);
    }
  }
}

const challengeSchema = z.object({
  v: z.literal(CHALLENGE_VERSION),
  origin: z.string().min(1).max(512),
  nonce: z.string().min(1).max(256),
  timestamp: z.number().int().positive(),
});

const challengeReqSchema = z.object({
  origin: z.string().min(1).max(512),
});

const requestedScopesSchema = z.array(z.string().trim().min(1).max(96)).max(128);

const sessionReqSchema = z.object({
  origin: z.string().min(1).max(512),
  pubkey: z.string().min(1).max(256),
  challenge: challengeSchema,
  signature: z.string().min(1).max(512),
  challengeHash: z.string().regex(/^0x[0-9a-fA-F]{64}$/).optional(),
  requestedScopes: requestedScopesSchema.optional(),
});

const qrStatusReqSchema = z.object({
  origin: z.string().min(1).max(512),
});

const verifyChallengeHashReqSchema = z.object({
  challenge: challengeSchema,
  challengeHash: z.string().regex(/^0x[0-9a-fA-F]{64}$/),
});

type SessionReq = z.infer<typeof sessionReqSchema>;

function parseSessionTtlSeconds(): number {
  const raw = Number(process.env.SESSION_TTL_SECONDS ?? 60 * 60);
  if (!Number.isFinite(raw) || raw <= 0) return 60 * 60;
  return Math.floor(raw);
}

function parseChallengeTtlSeconds(): number {
  const raw = Number(process.env.AUTH_CHALLENGE_TTL_SECONDS ?? DEFAULT_CHALLENGE_TTL_SECONDS);
  if (!Number.isFinite(raw) || raw <= 0) return DEFAULT_CHALLENGE_TTL_SECONDS;
  return Math.floor(raw);
}

function normalizeRequestedScopes(scopes: string[] | undefined): string[] {
  if (!scopes || scopes.length === 0) return [];
  const seen = new Set<string>();
  const normalized: string[] = [];
  for (const scope of scopes) {
    const key = scope.trim().toLowerCase();
    if (!key || seen.has(key)) continue;
    seen.add(key);
    normalized.push(key);
  }
  return normalized;
}

async function issueChallenge(normalizedOrigin: string, req: FastifyRequest, reply: FastifyReply) {
  const expiresAt = new Date(Date.now() + parseChallengeTtlSeconds() * 1000);

  for (let i = 0; i < 3; i++) {
    const nonce = `0x${randomBytes(32).toString('hex')}`;
    const timestamp = Math.floor(Date.now() / 1000);

    const challenge = {
      v: CHALLENGE_VERSION,
      origin: normalizedOrigin,
      nonce,
      timestamp,
    } as const;

    try {
      await prisma.authChallenge.create({
        data: {
          origin: normalizedOrigin,
          nonce,
          timestamp,
          expiresAt,
        },
      });
      return challenge;
    } catch (e: any) {
      if (e?.code === 'P2002') continue;
      logAndSendError(req, reply, 503, 'Challenge store unavailable', e);
      return null;
    }
  }

  sendError(reply, 503, 'Challenge generation failed');
  return null;
}

async function issueSessionFromSignedChallenge(
  req: FastifyRequest,
  reply: FastifyReply,
  payload: SessionReq,
  opts: { setCookie: boolean; includeSessionObject: boolean },
) {
  const { pubkey, signature, challenge } = payload;

  if (!isHex32(pubkey)) {
    return sendError(reply, 400, 'pubkey must be 0x-prefixed 32-byte hex');
  }
  if (!isHex64(signature)) {
    return sendError(reply, 400, 'signature must be 0x-prefixed 64-byte hex');
  }

  let normalizedOrigin: string;
  try {
    normalizedOrigin = normalizeOrigin(payload.origin);
  } catch (e) {
    return sendError(reply, 400, (e as Error).message);
  }

  if (challenge.origin !== normalizedOrigin) {
    return sendError(reply, 400, 'Challenge origin mismatch');
  }

  const nowUnix = Math.floor(Date.now() / 1000);
  if (challenge.timestamp > nowUnix + MAX_CHALLENGE_FUTURE_SKEW_SECONDS) {
    return sendError(reply, 409, 'Challenge timestamp is in the future');
  }

  let pending;
  try {
    pending = await prisma.authChallenge.findUnique({
      where: { origin_nonce: { origin: normalizedOrigin, nonce: challenge.nonce } },
    });
  } catch (e) {
    return logAndSendError(req, reply, 503, 'Challenge store unavailable', e);
  }

  if (!pending) {
    return sendError(reply, 409, 'Challenge not found (or already used)');
  }

  if (pending.expiresAt.getTime() <= Date.now()) {
    try {
      await prisma.authChallenge.delete({ where: { id: pending.id } });
    } catch (e) {
      req.log.warn({ err: e, challengeId: pending.id }, 'Expired challenge cleanup failed');
    }
    return sendError(reply, 409, 'Challenge expired');
  }

  if (pending.timestamp !== challenge.timestamp) {
    return sendError(reply, 409, 'Challenge mismatch');
  }

  const json = canonicalJsonStringify(challenge);
  const hash = sha256Hex(json);

  if (payload.challengeHash && payload.challengeHash.toLowerCase() !== hash.toLowerCase()) {
    return sendError(reply, 409, 'Challenge hash mismatch');
  }

  const sigBytes = Buffer.from(signature.slice(2), 'hex');
  const msgBytes = Buffer.from(hash.slice(2), 'hex');
  const pubBytes = Buffer.from(pubkey.slice(2), 'hex');

  let signatureValid = false;
  try {
    signatureValid = await schnorr.verify(sigBytes, msgBytes, pubBytes);
  } catch {
    signatureValid = false;
  }
  if (!signatureValid) {
    return sendError(reply, 401, 'Invalid signature');
  }

  try {
    await prisma.authChallenge.delete({ where: { id: pending.id } });
  } catch (e) {
    return logAndSendError(req, reply, 503, 'Challenge store unavailable', e);
  }

  const ttlSeconds = parseSessionTtlSeconds();
  const expiresAt = new Date(Date.now() + ttlSeconds * 1000);
  const requestedScopes = normalizeRequestedScopes(payload.requestedScopes);

  let session;
  try {
    session = await prisma.apiSession.create({
      data: {
        pubkey,
        origin: normalizedOrigin,
        scopesJson: requestedScopes,
        expiresAt,
      },
    });

    await prisma.user.upsert({
      where: { pubkey },
      create: { pubkey },
      update: {},
    });
  } catch (e) {
    return logAndSendError(req, reply, 503, 'Session store unavailable', e);
  }

  if (opts.setCookie) {
    reply.setCookie('bi_session', session.id, {
      path: '/',
      httpOnly: true,
      sameSite: 'lax',
      secure: process.env.COOKIE_SECURE === 'true',
    });
  }

  cleanupQrApprovalCache();
  qrApprovalCache.set(challenge.nonce, {
    sessionId: session.id,
    pubkey: session.pubkey,
    origin: session.origin,
    expiresAtUnix: Math.floor((Date.now() + QR_APPROVAL_CACHE_TTL_MS) / 1000),
    sessionExpiresAtUnix: Math.floor(session.expiresAt.getTime() / 1000),
    approvedAtUnix: Math.floor(Date.now() / 1000),
  });

  const base = {
    accessToken: session.id,
    tokenType: 'Bearer',
    authFlow: 'signed_challenge_v1',
    challengeVersion: CHALLENGE_VERSION,
    challengeHash: hash,
  };

  if (opts.includeSessionObject) {
    return reply.status(201).send(ok({
      session: {
        id: session.id,
        pubkey: session.pubkey,
        origin: session.origin,
        scopes: session.scopesJson,
        created_at: Math.floor(session.createdAt.getTime() / 1000),
        expires_at: Math.floor(session.expiresAt.getTime() / 1000),
      },
      ...base,
    }));
  }

  return reply.status(201).send(ok({
    ...base,
    expires_at: Math.floor(session.expiresAt.getTime() / 1000),
  }));
}

export async function registerAuthRoutes(app: FastifyInstance) {
  app.get('/auth/contracts', async (_req, reply) => {
    return reply.status(200).send(ok({
      contractVersion: AUTH_CONTRACT_VERSION,
      headed: {
        qr: {
          start: '/auth/qr/start',
          approve: '/auth/qr/approve',
          status: '/auth/qr/status/:nonce?origin=<origin>',
          payloadType: 'bitindie-auth-v1',
          qrPayloadField: 'challenge',
          lightningUriTemplate: 'lightning:bitindie-auth-v1?challenge=<base64url-json>',
          approvePayload: {
            origin: 'https://app.example',
            challenge: '{v,origin,nonce,timestamp}',
            pubkey: '0x-prefixed 32-byte hex',
            signature: '0x-prefixed 64-byte hex',
          },
          statusValues: ['pending', 'approved', 'expired_or_consumed'],
          challengeTtlSeconds: parseChallengeTtlSeconds(),
          pollIntervalMs: QR_POLL_INTERVAL_MS,
          handoff: {
            cookieName: 'bi_session',
            fallbackAuthorizationHeader: 'Bearer <accessToken>',
            approvedStatusFields: ['accessToken', 'tokenType', 'expires_at'],
          },
          exampleEndpoint: '/auth/qr/approve/example',
          constructionStatus: '/auth/qr/construction/status',
          loginManifest: '/auth/qr/login/manifest',
        },
        fallback: {
          challenge: '/auth/challenge',
          session: '/auth/session',
          cookieName: 'bi_session',
        },
      },
      headless: {
        challenge: '/auth/agent/challenge',
        verifyHash: '/auth/agent/verify-hash',
        session: '/auth/agent/session',
        tokenField: 'accessToken',
        tokenType: 'Bearer',
        signer: 'secp256k1-schnorr',
        signatureEncoding: '0x-hex-64-byte',
        pubkeyEncoding: '0x-hex-32-byte',
        challengeVersion: CHALLENGE_VERSION,
        challengeHash: {
          algorithm: 'sha256',
          canonicalization: 'json-sorted-keys',
          encoding: '0x-hex-32-byte',
        },
        optionalChallengeHashField: 'challengeHash',
        loginManifest: '/auth/agent/login/manifest',
      },
      constraints: {
        challengeTtlSeconds: parseChallengeTtlSeconds(),
        sessionTtlSeconds: parseSessionTtlSeconds(),
        maxChallengeFutureSkewSeconds: MAX_CHALLENGE_FUTURE_SKEW_SECONDS,
        requestedScopes: {
          maxItems: 128,
          itemType: 'string',
          normalization: 'trim + lowercase + de-duplicate',
        },
      },
    }));
  });


  app.get('/auth/login/surfaces', async (_req, reply) => {
    return reply.status(200).send(ok({
      contractVersion: AUTH_CONTRACT_VERSION,
      objective: 'single lookup for human + agent login lanes and entitlement handoff contracts',
      surfaces: {
        headed: {
          authFlow: 'lightning_qr_approve_v1',
          loginManifest: '/auth/qr/login/manifest',
          contracts: '/auth/qr/contracts',
          sessionContracts: '/auth/qr/session/contracts',
          start: '/auth/qr/start',
          approve: '/auth/qr/approve',
          status: '/auth/qr/status/:nonce?origin=<origin>',
          approveContracts: '/auth/qr/approve/contracts',
      example: '/auth/qr/approve/example',
          sessionHandoff: {
            cookie: 'bi_session=<accessToken>',
            authorizationHeader: 'Bearer <accessToken>',
          },
          entitlementModes: {
            directDownload: '/storefront/entitlement/path?surface=headed&mode=direct_download',
            tokenizedAccess: '/storefront/entitlement/path?surface=headed&mode=tokenized_access',
          },
        },
        headless: {
          authFlow: 'signed_challenge_v1',
          loginManifest: '/auth/agent/login/manifest',
          contracts: '/auth/agent/contracts',
          challenge: '/auth/agent/challenge',
          challengeFixture: '/auth/agent/challenge/example',
          verifyHash: '/auth/agent/verify-hash',
          session: '/auth/agent/session',
          example: '/auth/agent/signed-challenge/example',
          tokenHandoff: {
            tokenType: 'Bearer',
            tokenField: 'accessToken',
          },
          entitlementModes: {
            tokenizedAccess: '/storefront/entitlement/path?surface=headless&mode=tokenized_access',
          },
        },
      },
      sharedConstraints: {
        challengeTtlSeconds: parseChallengeTtlSeconds(),
        sessionTtlSeconds: parseSessionTtlSeconds(),
        requestedScopesMaxItems: 128,
      },
    }));
  });

  app.get('/auth/session/contracts/surfaces', async (_req, reply) => {
    return reply.status(200).send(ok({
      contractVersion: AUTH_CONTRACT_VERSION,
      objective: 'first-class session contract map for headed + headless login surfaces',
      surfaces: {
        headed: {
          authFlow: 'lightning_qr_approve_v1',
          loginManifest: '/auth/qr/login/manifest',
          sessionContracts: '/auth/qr/session/contracts',
          statusContracts: '/auth/qr/status/contracts',
          handoff: {
            cookieName: 'bi_session',
            authorizationHeader: 'Bearer <accessToken>',
          },
          entitlementBridge: {
            direct: '/storefront/entitlement/path?surface=headed&mode=direct_download',
            tokenized: '/storefront/entitlement/path?surface=headed&mode=tokenized_access',
          },
        },
        headless: {
          authFlow: 'signed_challenge_v1',
          loginManifest: '/auth/agent/login/manifest',
          challengeContracts: '/auth/agent/challenge/contracts',
          sessionContracts: '/auth/agent/session/contracts',
          handoff: {
            tokenField: 'accessToken',
            tokenType: 'Bearer',
          },
          entitlementBridge: {
            tokenized: '/storefront/entitlement/path?surface=headless&mode=tokenized_access',
          },
        },
      },
      shared: {
        challengeTtlSeconds: parseChallengeTtlSeconds(),
        sessionTtlSeconds: parseSessionTtlSeconds(),
        requestedScopesMaxItems: 128,
      },
    }));
  });

  app.get('/auth/login/construction/manifest', async (_req, reply) => {
    return reply.status(200).send(ok({
      contractVersion: AUTH_CONTRACT_VERSION,
      mode: 'auth-store-construction',
      objective: 'implementation-ready login manifest for humans (headed) and agents (headless)',
      lanes: {
        headedHumanLightning: {
          phase: 'A',
          authFlow: 'lightning_qr_approve_v1',
          contracts: '/auth/qr/contracts',
          loginManifest: '/auth/qr/login/manifest',
          sessionContracts: '/auth/qr/session/contracts',
          steps: ['/auth/qr/start', '/auth/qr/approve', '/auth/qr/status/:nonce?origin=<origin>'],
          handoff: {
            cookieName: 'bi_session',
            authorizationHeader: 'Bearer <accessToken>',
          },
        },
        headlessSignedChallenge: {
          phase: 'B',
          authFlow: 'signed_challenge_v1',
          contracts: '/auth/agent/contracts',
          loginManifest: '/auth/agent/login/manifest',
          sessionContracts: '/auth/agent/session/contracts',
          steps: ['/auth/agent/challenge', '/auth/agent/verify-hash', '/auth/agent/session'],
          handoff: {
            tokenField: 'accessToken',
            tokenType: 'Bearer',
          },
        },
      },
      entitlementBridge: {
        headed: {
          direct: '/storefront/entitlement/path?surface=headed&mode=direct_download',
          tokenized: '/storefront/entitlement/path?surface=headed&mode=tokenized_access',
        },
        headless: {
          tokenized: '/storefront/entitlement/path?surface=headless&mode=tokenized_access',
        },
      },
      sharedConstraints: {
        challengeTtlSeconds: parseChallengeTtlSeconds(),
        sessionTtlSeconds: parseSessionTtlSeconds(),
        requestedScopesMaxItems: 128,
      },
    }));
  });

  app.get('/auth/entitlement/construction/contracts', async (_req, reply) => {
    return reply.status(200).send(ok({
      contractVersion: AUTH_CONTRACT_VERSION,
      mode: 'auth-store-construction',
      objective: 'explicit login-to-entitlement construction contracts for headed and headless lanes',
      laneOrder: [
        'A: headed lightning login',
        'B: headless signed-challenge auth',
        'C: entitlement path handoff',
        'D: storefront scaffold integration',
      ],
      lanes: {
        headed: {
          loginManifest: '/auth/qr/login/manifest',
          authSessionContracts: '/auth/qr/session/contracts',
          entitlement: {
            directDownload: '/storefront/entitlement/path?surface=headed&mode=direct_download',
            tokenizedAccess: '/storefront/entitlement/path?surface=headed&mode=tokenized_access',
            downloadContracts: '/storefront/download/contracts',
          },
        },
        headless: {
          loginManifest: '/auth/agent/login/manifest',
          authSessionContracts: '/auth/agent/session/contracts',
          entitlement: {
            tokenizedAccess: '/storefront/entitlement/path?surface=headless&mode=tokenized_access',
            downloadContracts: '/storefront/download/contracts',
          },
        },
      },
      storefront: {
        scaffoldParallelManifest: '/storefront/scaffold/parallel-lanes/manifest',
        authStoreSurfaces: '/storefront/contracts/auth-store/surfaces',
        playbook: '/storefront/playbook/login-to-entitlement',
      },
    }));
  });


  app.get('/auth/storefront/construction/runtime', async (_req, reply) => {
    return reply.status(200).send(ok({
      contractVersion: AUTH_CONTRACT_VERSION,
      mode: 'auth-store-construction',
      objective: 'runtime-backed auth-to-storefront construction map for priorities A/B/C/D',
      execution: {
        burstMode: 'two-wave-hybrid',
        waveOrder: ['A', 'B', 'C', 'D'],
        wavePairing: [
          ['A', 'B'],
          ['C', 'D'],
        ],
        nonOverlap: 'strict',
      },
      priorities: {
        A: {
          title: 'human lightning login implementation',
          runtime: {
            start: '/auth/qr/start',
            approve: '/auth/qr/approve',
            status: '/auth/qr/status/:nonce?origin=<origin>',
          },
          contracts: ['/auth/qr/contracts', '/auth/qr/login/manifest', '/auth/qr/session/contracts'],
        },
        B: {
          title: 'headless signed-challenge auth implementation',
          runtime: {
            challenge: '/auth/agent/challenge',
            verifyHash: '/auth/agent/verify-hash',
            session: '/auth/agent/session',
          },
          contracts: ['/auth/agent/challenge/contracts', '/auth/agent/session/contracts', '/auth/agent/login/manifest'],
        },
        C: {
          title: 'entitlement path support (download + tokenized access)',
          runtime: {
            download: '/releases/:releaseId/download',
            headedDirect: '/storefront/entitlement/path?surface=headed&mode=direct_download',
            headedTokenized: '/storefront/entitlement/path?surface=headed&mode=tokenized_access',
            headlessTokenized: '/storefront/entitlement/path?surface=headless&mode=tokenized_access',
          },
          contracts: ['/storefront/download/contracts', '/storefront/entitlements', '/storefront/entitlement/examples'],
        },
        D: {
          title: 'parallel storefront scaffolding (headed + headless)',
          runtime: {
            headed: '/storefront/scaffold?surface=headed',
            headless: '/storefront/scaffold?surface=headless',
            laneManifest: '/storefront/scaffold/parallel-lanes/manifest',
            authSurfaceContracts: '/auth/storefront/scaffold/contracts',
          },
          contracts: ['/storefront/scaffold/contracts', '/storefront/scaffold/surfaces/contracts', '/storefront/scaffold/construction/handoff', '/auth/storefront/scaffold/contracts'],
        },
      },
      mergeGates: {
        tests: 'npm test --silent',
        build: 'npm run build --silent',
        mergeMarkerScan: "rg '^(<<<<<<<|=======|>>>>>>>)' src",
      },
    }));
  });

  app.get('/auth/storefront/scaffold/contracts', async (_req, reply) => {
    return reply.status(200).send(ok({
      contractVersion: AUTH_CONTRACT_VERSION,
      version: 'auth-storefront-scaffold-contracts-v1',
      objective: 'first-class auth-owned contract surface for parallel headed + headless storefront scaffolding',
      surfaces: {
        headed: {
          loginManifest: '/auth/qr/login/manifest',
          sessionContracts: '/auth/qr/session/contracts',
          storefrontScaffold: '/storefront/scaffold?surface=headed',
          storefrontContracts: '/storefront/scaffold/contracts',
          entitlementPath: '/storefront/entitlement/path?surface=headed&mode=tokenized_access',
        },
        headless: {
          loginManifest: '/auth/agent/login/manifest',
          sessionContracts: '/auth/agent/session/contracts',
          storefrontScaffold: '/storefront/scaffold?surface=headless',
          storefrontContracts: '/storefront/scaffold/contracts',
          entitlementPath: '/storefront/entitlement/path?surface=headless&mode=tokenized_access',
        },
      },
      shared: {
        laneManifest: '/storefront/scaffold/parallel-lanes/manifest',
        surfaceContracts: '/storefront/scaffold/surfaces/contracts',
        handoff: '/storefront/scaffold/construction/handoff',
      },
    }));
  });

  app.get('/auth/storefront/construction/runtime/session-lifecycle', async (_req, reply) => {
    return reply.status(200).send(ok({
      contractVersion: AUTH_CONTRACT_VERSION,
      mode: 'auth-store-construction',
      objective: 'session lifecycle + entitlement consumption edge handling for headed and headless lanes',
      phases: {
        issueChallenge: {
          headed: '/auth/qr/start',
          headless: '/auth/agent/challenge',
          ttlSeconds: parseChallengeTtlSeconds(),
        },
        approveOrSign: {
          headed: '/auth/qr/approve',
          headless: '/auth/agent/session',
          optionalHashVerify: '/auth/agent/verify-hash',
        },
        pollOrHandoff: {
          headedStatus: '/auth/qr/status/:nonce?origin=<origin>',
          headedCookie: 'bi_session=<accessToken>',
          headlessToken: 'Bearer <accessToken>',
        },
        consumeEntitlement: {
          headedDirect: '/storefront/entitlement/path?surface=headed&mode=direct_download',
          headedTokenized: '/storefront/entitlement/path?surface=headed&mode=tokenized_access',
          headlessTokenized: '/storefront/entitlement/path?surface=headless&mode=tokenized_access',
          releaseDownload: '/releases/:releaseId/download',
        },
      },
      edgeHandling: {
        challengeExpired: '409 Challenge expired',
        challengeConsumed: '409 Challenge not found (or already used)',
        challengeFutureSkew: `409 if timestamp exceeds now + ${MAX_CHALLENGE_FUTURE_SKEW_SECONDS}s`,
        signatureInvalid: '401 Invalid signature',
        originMismatch: '400/409 Challenge origin mismatch',
      },
      mergeGates: {
        tests: 'npm test --silent',
        build: 'npm run build --silent',
        mergeMarkerScan: "rg '^(<<<<<<<|=======|>>>>>>>)' src",
      },
    }));
  });

  app.get('/auth/storefront/construction/runtime/executable-handoff', async (_req, reply) => {
    return reply.status(200).send(ok({
      contractVersion: AUTH_CONTRACT_VERSION,
      mode: 'auth-store-construction',
      objective: 'executable handoff contract for headed/headless session materialization into storefront shell handlers',
      handlers: {
        headed: {
          challengeStart: '/auth/qr/start',
          approve: '/auth/qr/approve',
          statusPoll: '/auth/qr/status/:nonce?origin=<origin>',
          handoff: {
            cookie: 'bi_session=<accessToken>',
            authorizationHeader: 'Bearer <accessToken>',
            storefrontShellHandler: '/storefront/scaffold/construction/shell-handlers?surface=headed',
          },
        },
        headless: {
          challenge: '/auth/agent/challenge',
          challengeFixture: '/auth/agent/challenge/example',
          verifyHash: '/auth/agent/verify-hash',
          session: '/auth/agent/session',
          handoff: {
            tokenType: 'Bearer',
            tokenField: 'accessToken',
            storefrontShellHandler: '/storefront/scaffold/construction/shell-handlers?surface=headless',
          },
        },
      },
      entitlementConsumption: {
        contracts: '/storefront/scaffold/construction/entitlement-consumption',
        telemetry: '/storefront/scaffold/construction/entitlement-telemetry',
      },
      sequencing: {
        waveA: 'login session issuance + handoff',
        waveB: 'storefront shell resolution + entitlement consumption',
        nonOverlapBoundary: 'auth route handlers own session issuance; storefront route handlers own entitlement surface execution',
      },
      mergeGates: {
        tests: 'npm test --silent',
        build: 'npm run build --silent',
        mergeMarkerScan: "rg '^(<<<<<<<|=======|>>>>>>>)' src",
      },
    }));
  });

  app.get('/auth/storefront/construction/runtime/telemetry-emit-points', async (_req, reply) => {
    return reply.status(200).send(ok({
      contractVersion: AUTH_CONTRACT_VERSION,
      mode: 'auth-store-construction',
      objective: 'pin concrete auth runtime emit points that feed storefront entitlement telemetry',
      emitPoints: {
        headed: {
          issueChallenge: {
            endpoint: '/auth/qr/start',
            emits: ['auth.challenge_issued'],
          },
          approveAndMintSession: {
            endpoint: '/auth/qr/approve',
            emits: ['auth.session_issued', 'auth.handoff_ready'],
          },
          pollApproved: {
            endpoint: '/auth/qr/status/:nonce?origin=<origin>',
            emits: ['auth.session_confirmed'],
          },
        },
        headless: {
          challenge: {
            endpoint: '/auth/agent/challenge',
            emits: ['auth.challenge_issued'],
          },
          session: {
            endpoint: '/auth/agent/session',
            emits: ['auth.session_issued', 'auth.handoff_ready'],
          },
        },
      },
      downstream: {
        telemetrySchema: '/storefront/scaffold/construction/entitlement-telemetry',
        telemetryRuntime: '/storefront/scaffold/construction/entitlement-telemetry/runtime-emit-points',
      },
      nonOverlapBoundary: 'auth emits handoff/session lifecycle events; storefront emits entitlement path and consumption events',
      mergeGates: {
        tests: 'npm test --silent',
        build: 'npm run build --silent',
        mergeMarkerScan: "rg '^(<<<<<<<|=======|>>>>>>>)' src",
      },
    }));
  });

  app.get('/auth/storefront/construction/runtime/telemetry/payload-templates', async (_req, reply) => {
    return reply.status(200).send(ok({
      contractVersion: AUTH_CONTRACT_VERSION,
      mode: 'auth-store-construction',
      version: 'auth-runtime-telemetry-payloads-v1',
      objective: 'deterministic auth payload templates for runtime emit points consumed by storefront trace fixtures',
      payloads: {
        challengeIssued: {
          event: 'auth.challenge_issued',
          fields: ['surface', 'origin', 'nonce', 'challengeVersion', 'issuedAtUnix'],
          samples: {
            headed: {
              surface: 'headed',
              origin: 'https://app.bitindie.example:443',
              nonce: '0x<32-byte-hex>',
              challengeVersion: CHALLENGE_VERSION,
              issuedAtUnix: 1700000000,
            },
            headless: {
              surface: 'headless',
              origin: 'https://agent.bitindie.example:443',
              nonce: '0x<32-byte-hex>',
              challengeVersion: CHALLENGE_VERSION,
              issuedAtUnix: 1700000000,
            },
          },
        },
        sessionIssued: {
          event: 'auth.session_issued',
          fields: ['surface', 'origin', 'sessionId', 'pubkey', 'expiresAtUnix', 'scopes'],
          samples: {
            headed: {
              surface: 'headed',
              origin: 'https://app.bitindie.example:443',
              sessionId: '<uuid>',
              pubkey: '0x<32-byte-hex>',
              expiresAtUnix: 1700003600,
              scopes: ['download'],
            },
            headless: {
              surface: 'headless',
              origin: 'https://agent.bitindie.example:443',
              sessionId: '<uuid>',
              pubkey: '0x<32-byte-hex>',
              expiresAtUnix: 1700003600,
              scopes: ['download', 'store:read'],
            },
          },
        },
        handoffReady: {
          event: 'auth.handoff_ready',
          fields: ['surface', 'sessionTransport', 'tokenField', 'storefrontShellHandler', 'readyAtUnix'],
          samples: {
            headed: {
              surface: 'headed',
              sessionTransport: 'cookie',
              tokenField: 'bi_session',
              storefrontShellHandler: '/storefront/scaffold/construction/shell-handlers?surface=headed',
              readyAtUnix: 1700000001,
            },
            headless: {
              surface: 'headless',
              sessionTransport: 'bearer',
              tokenField: 'accessToken',
              storefrontShellHandler: '/storefront/scaffold/construction/shell-handlers?surface=headless',
              readyAtUnix: 1700000001,
            },
          },
        },
      },
      downstreamFixtures: '/storefront/scaffold/construction/entitlement-telemetry/trace-fixtures',
      mergeGates: {
        tests: 'npm test --silent',
        build: 'npm run build --silent',
        mergeMarkerScan: "rg '^(<<<<<<<|=======|>>>>>>>)' src",
      },
    }));
  });

  app.get('/auth/storefront/construction/runtime/integration-checks', async (_req, reply) => {
    return reply.status(200).send(ok({
      contractVersion: AUTH_CONTRACT_VERSION,
      mode: 'auth-store-construction',
      version: 'auth-store-integration-checks-v1',
      objective: 'executable integration checks binding auth session issuance to storefront entitlement transport lanes',
      checks: {
        headedQrToTokenizedDownload: {
          surface: 'headed',
          steps: ['/auth/qr/start', '/auth/qr/approve', '/auth/qr/status/:nonce?origin=<origin>'],
          handoff: {
            primary: 'bi_session cookie',
            fallback: 'Authorization: Bearer <accessToken>',
          },
          entitlementProbe: '/storefront/entitlement/path?surface=headed&mode=tokenized_access',
          downloadProbe: '/releases/:releaseId/download?accessToken=<accessToken>',
          expectedTelemetry: ['auth.session_issued', 'auth.handoff_ready', 'entitlement.path_resolved'],
        },
        headlessSignedChallengeToTokenizedDownload: {
          surface: 'headless',
          steps: ['/auth/agent/challenge', '/auth/agent/verify-hash', '/auth/agent/session'],
          handoff: {
            primary: 'Authorization: Bearer <accessToken>',
            alternate: '?accessToken=<accessToken>',
          },
          entitlementProbe: '/storefront/entitlement/path?surface=headless&mode=tokenized_access',
          downloadProbe: '/releases/:releaseId/download',
          expectedTelemetry: ['auth.session_issued', 'auth.handoff_ready', 'entitlement.path_resolved'],
        },
      },
      dependencies: {
        authPayloadTemplates: '/auth/storefront/construction/runtime/telemetry/payload-templates',
        storefrontTraceFixtures: '/storefront/scaffold/construction/entitlement-telemetry/trace-fixtures',
        storefrontTokenTransport: '/storefront/scaffold/construction/token-transport/contracts',
      },
      mergeGates: {
        tests: 'npm test --silent',
        build: 'npm run build --silent',
        mergeMarkerScan: "rg '^(<<<<<<<|=======|>>>>>>>)' src",
      },
    }));
  });



  app.get('/auth/storefront/construction/runtime/release-download-acceptance', async (_req, reply) => {
    return reply.status(200).send(ok({
      contractVersion: AUTH_CONTRACT_VERSION,
      mode: 'auth-store-construction',
      version: 'auth-store-release-download-acceptance-v1',
      objective: 'acceptance matrix for headed direct-download and tokenized fallback behavior after auth handoff',
      scenarios: {
        headedDirectDownloadHappyPath: {
          surface: 'headed',
          loginFlow: ['/auth/qr/start', '/auth/qr/approve', '/auth/qr/status/:nonce?origin=<origin>'],
          entitlementPath: '/storefront/entitlement/path?surface=headed&mode=direct_download',
          releaseDownload: '/releases/:releaseId/download?buyerUserId=<buyerUserId>&guestReceiptCode=<guestReceiptCode>',
          expectedResult: '200 direct artifact stream',
          expectedTelemetry: ['auth.session_issued', 'entitlement.path_resolved', 'entitlement.consumed'],
        },
        headedTokenizedFallback: {
          surface: 'headed',
          fallbackTrigger: 'missing_or_invalid direct-download fields',
          entitlementPath: '/storefront/entitlement/path?surface=headed&mode=tokenized_access',
          releaseDownload: '/releases/:releaseId/download?accessToken=<accessToken>',
          acceptedTokenInputs: ['bi_session cookie', 'Authorization: Bearer <accessToken>', '?accessToken=<accessToken>'],
          expectedResult: '200 tokenized artifact stream',
        },
        headlessTokenizedAccess: {
          surface: 'headless',
          loginFlow: ['/auth/agent/challenge', '/auth/agent/verify-hash', '/auth/agent/session'],
          entitlementPath: '/storefront/entitlement/path?surface=headless&mode=tokenized_access',
          releaseDownload: '/releases/:releaseId/download',
          acceptedTokenInputs: ['Authorization: Bearer <accessToken>', '?accessToken=<accessToken>'],
          expectedResult: '200 tokenized artifact stream',
          expectedTelemetry: ['auth.session_issued', 'auth.handoff_ready', 'entitlement.path_resolved', 'entitlement.consumed'],
        },
      },
      dependencies: {
        integrationChecks: '/auth/storefront/construction/runtime/integration-checks',
        tokenTransportContracts: '/storefront/scaffold/construction/token-transport/contracts',
        storefrontAcceptanceFixtures: '/storefront/scaffold/construction/release-download/acceptance-fixtures',
      },
      mergeGates: {
        tests: 'npm test --silent',
        build: 'npm run build --silent',
        mergeMarkerScan: "rg '^(<<<<<<<|=======|>>>>>>>)' src",
      },
    }));
  });

  app.get('/auth/storefront/construction/runtime/release-download-smoke-manifest', async (_req, reply) => {
    return reply.status(200).send(ok({
      contractVersion: AUTH_CONTRACT_VERSION,
      mode: 'auth-store-construction',
      version: 'auth-store-release-download-smoke-manifest-v1',
      objective: 'single executable smoke manifest that binds human lightning and headless signed-challenge lanes to storefront download assertions',
      suites: {
        headedDirectDownload: {
          lane: 'A->C',
          authFlow: ['/auth/qr/start', '/auth/qr/approve', '/auth/qr/status/:nonce?origin=<origin>'],
          entitlementPath: '/storefront/entitlement/path?surface=headed&mode=direct_download',
          download: '/releases/:releaseId/download?buyerUserId=<buyerUserId>&guestReceiptCode=<guestReceiptCode>',
          expectedStatus: 200,
        },
        headedTokenizedFallback: {
          lane: 'A->C',
          trigger: 'invalid_direct_inputs',
          entitlementPath: '/storefront/entitlement/path?surface=headed&mode=tokenized_access',
          download: '/releases/:releaseId/download?accessToken=<accessToken>',
          acceptedTokenInputs: ['bi_session cookie', 'Authorization: Bearer <accessToken>', '?accessToken=<accessToken>'],
          expectedStatus: 200,
        },
        headlessTokenizedAccess: {
          lane: 'B->C',
          authFlow: ['/auth/agent/challenge', '/auth/agent/verify-hash', '/auth/agent/session'],
          entitlementPath: '/storefront/entitlement/path?surface=headless&mode=tokenized_access',
          download: '/releases/:releaseId/download',
          acceptedTokenInputs: ['Authorization: Bearer <accessToken>', '?accessToken=<accessToken>'],
          expectedStatus: 200,
        },
      },
      fixtures: '/storefront/scaffold/construction/release-download/smoke-fixtures',
      upstream: {
        runtimeAcceptance: '/auth/storefront/construction/runtime/release-download-acceptance',
        integrationChecks: '/auth/storefront/construction/runtime/integration-checks',
      },
      mergeGates: {
        tests: 'npm test --silent',
        build: 'npm run build --silent',
        mergeMarkerScan: "rg '^(<<<<<<<|=======|>>>>>>>)' src",
      },
    }));
  });

  app.get('/auth/storefront/construction/runtime/execution-lanes', async (_req, reply) => {
    return reply.status(200).send(ok({
      contractVersion: AUTH_CONTRACT_VERSION,
      mode: 'auth-store-construction',
      version: 'auth-store-runtime-execution-lanes-v1',
      objective: 'runnable headed/headless lane scripts for login-to-download smoke execution with strict non-overlap ownership',
      lanes: {
        headedHumanQr: {
          ownership: 'auth route handlers own challenge/session issuance; storefront handlers consume entitlement path',
          runbook: [
            { step: 1, endpoint: '/auth/qr/start', expect: 'challenge + lightning uri' },
            { step: 2, endpoint: '/auth/qr/approve', expect: 'session + bi_session cookie' },
            { step: 3, endpoint: '/auth/qr/status/:nonce?origin=<origin>', expect: 'approved + accessToken' },
            { step: 4, endpoint: '/storefront/entitlement/path?surface=headed&mode=tokenized_access', expect: 'supported=true' },
            { step: 5, endpoint: '/releases/:releaseId/download?accessToken=<accessToken>', expect: '200 artifact stream' },
          ],
        },
        headlessSignedChallenge: {
          ownership: 'agent auth handlers own challenge/hash/session; storefront handlers consume tokenized entitlement path',
          runbook: [
            { step: 1, endpoint: '/auth/agent/challenge', expect: 'challenge + hash preview' },
            { step: 2, endpoint: '/auth/agent/verify-hash', expect: 'matches=true' },
            { step: 3, endpoint: '/auth/agent/session', expect: 'Bearer accessToken' },
            { step: 4, endpoint: '/storefront/entitlement/path?surface=headless&mode=tokenized_access', expect: 'supported=true' },
            { step: 5, endpoint: '/releases/:releaseId/download', expect: '200 with Authorization: Bearer <accessToken>' },
          ],
        },
      },
      dependencies: {
        smokeManifest: '/auth/storefront/construction/runtime/release-download-smoke-manifest',
        storefrontBridge: '/storefront/scaffold/construction/login-entitlement-bridge',
        storefrontExecutionChecklist: '/storefront/scaffold/construction/execution-checklist',
      },
      mergeGates: {
        tests: 'npm test --silent',
        build: 'npm run build --silent',
        mergeMarkerScan: "rg '^(<<<<<<<|=======|>>>>>>>)' src",
      },
    }));
  });


  app.get('/auth/storefront/construction/runtime/fixture-payload-skeletons', async (_req, reply) => {
    return reply.status(200).send(ok({
      contractVersion: AUTH_CONTRACT_VERSION,
      mode: 'auth-store-construction',
      version: 'auth-store-runtime-fixture-payload-skeletons-v1',
      objective: 'deterministic JSON payload skeletons to execute headed QR approve and headless signed-challenge lanes in CI',
      payloadSkeletons: {
        headedApprovePayload: {
          path: 'headed-approve-payload.json',
          shape: {
            origin: 'https://app.bitindie.example',
            challenge: {
              v: CHALLENGE_VERSION,
              origin: 'https://app.bitindie.example:443',
              nonce: '0x<32-byte-hex>',
              timestamp: 1700000000,
            },
            pubkey: '0x<32-byte-hex>',
            signature: '0x<64-byte-hex>',
            requestedScopes: ['download', 'store:read'],
          },
        },
        headlessVerifyPayload: {
          path: 'headless-verify-payload.json',
          shape: {
            challenge: {
              v: CHALLENGE_VERSION,
              origin: 'https://agent.bitindie.example:443',
              nonce: '0x<32-byte-hex>',
              timestamp: 1700000000,
            },
            challengeHash: '0x<32-byte-hex>',
          },
        },
        headlessSessionPayload: {
          path: 'headless-session-payload.json',
          shape: {
            origin: 'https://agent.bitindie.example',
            challenge: {
              v: CHALLENGE_VERSION,
              origin: 'https://agent.bitindie.example:443',
              nonce: '0x<32-byte-hex>',
              timestamp: 1700000000,
            },
            pubkey: '0x<32-byte-hex>',
            signature: '0x<64-byte-hex>',
            challengeHash: '0x<32-byte-hex>',
            requestedScopes: ['download', 'store:read'],
          },
        },
      },
      dependencies: {
        ciCommandTemplates: '/auth/storefront/construction/runtime/ci-command-templates',
        storefrontFixturePayloads: '/storefront/scaffold/construction/fixture-payload-skeletons',
        executionLanes: '/auth/storefront/construction/runtime/execution-lanes',
      },
      mergeGates: {
        tests: 'npm test --silent',
        build: 'npm run build --silent',
        mergeMarkerScan: "rg '^(<<<<<<<|=======|>>>>>>>)' src",
      },
    }));
  });

  app.get('/auth/storefront/construction/runtime/fixture-bundle-manifest', async (_req, reply) => {
    return reply.status(200).send(ok({
      contractVersion: AUTH_CONTRACT_VERSION,
      mode: 'auth-store-construction',
      version: 'auth-store-runtime-fixture-bundle-manifest-v1',
      objective: 'single-file fixture bundle manifest for auth lanes so CI can fetch one endpoint and materialize all auth payloads',
      bundle: {
        file: 'auth-runtime-fixtures.bundle.json',
        bundleVersion: 'auth-runtime-fixtures.bundle.v2',
        bundleDigest: 'sha256:auth-runtime-fixtures-bundle-v2-contract-digest',
        generatedFrom: '/auth/storefront/construction/runtime/fixture-payload-skeletons',
        payloads: [
          {
            id: 'headed-approve',
            path: 'headed-approve-payload.json',
            purpose: 'POST /auth/qr/approve',
          },
          {
            id: 'headless-verify',
            path: 'headless-verify-payload.json',
            purpose: 'POST /auth/agent/verify-hash',
          },
          {
            id: 'headless-session',
            path: 'headless-session-payload.json',
            purpose: 'POST /auth/agent/session',
          },
        ],
      },
      execution: {
        fetchOnceEndpoint: '/auth/storefront/construction/runtime/fixture-bundle-manifest',
        companionStorefrontBundle: '/storefront/scaffold/construction/fixture-bundle-manifest',
        compatibilityMatrix: '/auth/storefront/construction/runtime/fixture-bundle-compatibility',
        executableExamples: ['/auth/storefront/construction/runtime/ci-command-templates'],
      },
      dependencies: {
        fixturePayloadSkeletons: '/auth/storefront/construction/runtime/fixture-payload-skeletons',
        ciCommandTemplates: '/auth/storefront/construction/runtime/ci-command-templates',
        executionLanes: '/auth/storefront/construction/runtime/execution-lanes',
      },
      mergeGates: {
        tests: 'npm test --silent',
        build: 'npm run build --silent',
        mergeMarkerScan: "rg '^(<<<<<<<|=======|>>>>>>>)' src",
      },
    }));
  });

  app.get('/auth/storefront/construction/runtime/fixture-bundle-compatibility', async (_req, reply) => {
    return reply.status(200).send(ok({
      contractVersion: AUTH_CONTRACT_VERSION,
      mode: 'auth-store-construction',
      version: 'auth-store-runtime-fixture-bundle-compatibility-v1',
      objective: 'cross-bundle compatibility matrix so CI can fail fast on auth/storefront fixture skew',
      bundles: {
        auth: {
          manifest: '/auth/storefront/construction/runtime/fixture-bundle-manifest',
          bundleVersion: 'auth-runtime-fixtures.bundle.v2',
          bundleDigest: 'sha256:auth-runtime-fixtures-bundle-v2-contract-digest',
        },
        storefront: {
          manifest: '/storefront/scaffold/construction/fixture-bundle-manifest',
          bundleVersion: 'storefront-runtime-fixtures.bundle.v2',
          bundleDigest: 'sha256:storefront-runtime-fixtures-bundle-v2-contract-digest',
        },
      },
      compatibility: [
        {
          authBundleVersion: 'auth-runtime-fixtures.bundle.v2',
          storefrontBundleVersion: 'storefront-runtime-fixtures.bundle.v2',
          status: 'compatible',
          requiredFor: ['headed-human-qr lane', 'headless-signed-challenge lane'],
        },
      ],
      failFastContract: {
        ifUnknownPair: 'reject_ci_run',
        reason: 'fixture bundle version skew',
      },
      dependencies: {
        authBundleManifest: '/auth/storefront/construction/runtime/fixture-bundle-manifest',
        storefrontBundleManifest: '/storefront/scaffold/construction/fixture-bundle-manifest',
        storefrontCompatibilityMirror: '/storefront/scaffold/construction/fixture-bundle-compatibility',
      },
      mergeGates: {
        tests: 'npm test --silent',
        build: 'npm run build --silent',
        mergeMarkerScan: "rg '^(<<<<<<<|=======|>>>>>>>)' src",
      },
    }));
  });

  app.get('/auth/storefront/construction/runtime/ci-command-templates', async (_req, reply) => {
    return reply.status(200).send(ok({
      contractVersion: AUTH_CONTRACT_VERSION,
      mode: 'auth-store-construction',
      version: 'auth-store-runtime-ci-command-templates-v1',
      objective: 'copy-paste command templates to execute headed/headless login-to-download lanes in CI without ownership overlap',
      commandTemplates: {
        headedHumanQr: [
          "curl -sS -X POST '$ORIGIN/auth/qr/start' -H 'content-type: application/json' -d '{\"origin\":\"$APP_ORIGIN\"}'",
          "curl -sS -X POST '$ORIGIN/auth/qr/approve' -H 'content-type: application/json' -d @headed-approve-payload.json",
          "curl -sS '$ORIGIN/auth/qr/status/$NONCE?origin=$APP_ORIGIN'",
          "curl -sS '$ORIGIN/storefront/entitlement/path?surface=headed&mode=tokenized_access'",
          "curl -sS -H 'Authorization: Bearer $ACCESS_TOKEN' '$ORIGIN/releases/$RELEASE_ID/download' -o /tmp/headed-download.bin",
        ],
        headlessSignedChallenge: [
          "curl -sS -X POST '$ORIGIN/auth/agent/challenge' -H 'content-type: application/json' -d '{\"origin\":\"$APP_ORIGIN\"}'",
          "curl -sS -X POST '$ORIGIN/auth/agent/verify-hash' -H 'content-type: application/json' -d @headless-verify-payload.json",
          "curl -sS -X POST '$ORIGIN/auth/agent/session' -H 'content-type: application/json' -d @headless-session-payload.json",
          "curl -sS '$ORIGIN/storefront/entitlement/path?surface=headless&mode=tokenized_access'",
          "curl -sS -H 'Authorization: Bearer $ACCESS_TOKEN' '$ORIGIN/releases/$RELEASE_ID/download' -o /tmp/headless-download.bin",
        ],
      },
      artifacts: {
        headedApprovePayload: 'headed-approve-payload.json',
        headlessVerifyPayload: 'headless-verify-payload.json',
        headlessSessionPayload: 'headless-session-payload.json',
      },
      dependencies: {
        executionLanes: '/auth/storefront/construction/runtime/execution-lanes',
        smokeManifest: '/auth/storefront/construction/runtime/release-download-smoke-manifest',
        storefrontCiTemplates: '/storefront/scaffold/construction/ci-command-templates',
      },
      mergeGates: {
        tests: 'npm test --silent',
        build: 'npm run build --silent',
        mergeMarkerScan: "rg '^(<<<<<<<|=======|>>>>>>>)' src",
      },
    }));
  });

  app.get('/auth/qr/contracts', async (_req, reply) => {
    return reply.status(200).send(ok({
      contractVersion: AUTH_CONTRACT_VERSION,
      authFlow: 'lightning_qr_approve_v1',
      challengeVersion: CHALLENGE_VERSION,
      start: '/auth/qr/start',
      approve: '/auth/qr/approve',
      status: '/auth/qr/status/:nonce?origin=<origin>',
      payloadType: 'bitindie-auth-v1',
      qrPayloadField: 'challenge',
      lightningUriTemplate: 'lightning:bitindie-auth-v1?challenge=<base64url-json>',
      challengeTtlSeconds: parseChallengeTtlSeconds(),
      pollIntervalMs: QR_POLL_INTERVAL_MS,
      statusValues: ['pending', 'approved', 'expired_or_consumed'],
      approvePayload: {
        origin: 'https://app.example',
        challenge: '{v,origin,nonce,timestamp}',
        pubkey: '0x-prefixed 32-byte hex',
        signature: '0x-prefixed 64-byte hex',
      },
      handoff: {
        cookieName: 'bi_session',
        fallbackAuthorizationHeader: 'Bearer <accessToken>',
        approvedStatusFields: ['accessToken', 'tokenType', 'expires_at'],
      },
      constructionStatus: '/auth/qr/construction/status',
      approveContracts: '/auth/qr/approve/contracts',
      exampleEndpoint: '/auth/qr/approve/example',
    }));
  });

  app.get('/auth/qr/construction/status', async (_req, reply) => {
    return reply.status(200).send(ok({
      contractVersion: AUTH_CONTRACT_VERSION,
      phase: 'A',
      title: 'human lightning login implementation',
      authFlow: 'lightning_qr_approve_v1',
      readiness: {
        challengeIssue: '/auth/qr/start',
        challengeApprove: '/auth/qr/approve',
        challengePoll: '/auth/qr/status/:nonce?origin=<origin>',
        loginManifest: '/auth/qr/login/manifest',
        sessionContracts: '/auth/qr/session/contracts',
        statusContracts: '/auth/qr/status/contracts',
        approveContracts: '/auth/qr/approve/contracts',
        ready: true,
      },
      handoff: {
        cookieName: 'bi_session',
        authorizationHeader: 'Bearer <accessToken>',
        storefrontTokenizedPath: '/storefront/entitlement/path?surface=headed&mode=tokenized_access',
      },
      constraints: {
        challengeTtlSeconds: parseChallengeTtlSeconds(),
        pollIntervalMs: QR_POLL_INTERVAL_MS,
      },
      nextPhase: {
        phase: 'B',
        endpoint: '/auth/agent/construction/status',
      },
    }));
  });

  app.get('/auth/qr/approve/contracts', async (_req, reply) => {
    return reply.status(200).send(ok({
      contractVersion: AUTH_CONTRACT_VERSION,
      authFlow: 'lightning_qr_approve_v1',
      endpoint: '/auth/qr/approve',
      method: 'POST',
      request: {
        required: ['origin', 'pubkey', 'challenge', 'signature'],
        optional: ['challengeHash', 'requestedScopes'],
        challengeShape: '{v,origin,nonce,timestamp}',
      },
      response: {
        fields: ['session', 'accessToken', 'tokenType', 'authFlow', 'challengeVersion', 'challengeHash', 'expires_at'],
        sessionFields: ['id', 'pubkey', 'origin', 'scopes', 'created_at', 'expires_at'],
      },
      handoff: {
        cookieName: 'bi_session',
        statusEndpoint: '/auth/qr/status/:nonce?origin=<origin>',
        authorizationHeader: 'Bearer <accessToken>',
      },
      entitlementBridge: {
        headedTokenizedPath: '/storefront/entitlement/path?surface=headed&mode=tokenized_access',
        headedDirectPath: '/storefront/entitlement/path?surface=headed&mode=direct_download',
      },
      exampleEndpoint: '/auth/qr/approve/example',
    }));
  });

  app.get('/auth/qr/approve/example', async (_req, reply) => {
    return reply.status(200).send(ok({
      contractVersion: AUTH_CONTRACT_VERSION,
      authFlow: 'lightning_qr_approve_v1',
      purpose: 'human-login-and-cookie-handoff',
      steps: [
        {
          step: 1,
          action: 'create QR challenge',
          endpoint: '/auth/qr/start',
          payload: { origin: 'https://app.bitindie.local' },
        },
        {
          step: 2,
          action: 'wallet scans lightning uri and signs challenge',
          lightningUri: 'lightning:bitindie-auth-v1?challenge=<base64url-json>',
          signedPayload: {
            origin: 'https://app.bitindie.local',
            challenge: '{v,origin,nonce,timestamp}',
            pubkey: '0x-prefixed 32-byte hex',
            signature: '0x-prefixed 64-byte hex',
          },
        },
        {
          step: 3,
          action: 'approve challenge and mint session',
          endpoint: '/auth/qr/approve',
          method: 'POST',
          responseFields: ['session.id', 'accessToken', 'tokenType', 'expires_at', 'challengeHash'],
        },
        {
          step: 4,
          action: 'browser polls status until approved',
          endpoint: '/auth/qr/status/:nonce?origin=<origin>',
          successStatus: 'approved',
          handoff: {
            cookie: 'bi_session=<accessToken>',
            authorizationHeader: 'Bearer <accessToken>',
          },
        },
        {
          step: 5,
          action: 'continue to storefront entitlement path',
          endpoint: '/storefront/entitlement/path?surface=headed&mode=tokenized_access',
        },
      ],
    }));
  });

  app.get('/auth/qr/login/manifest', async (_req, reply) => {
    return reply.status(200).send(ok({
      contractVersion: AUTH_CONTRACT_VERSION,
      authFlow: 'lightning_qr_approve_v1',
      objective: 'human lightning login with cookie handoff into entitlement/download paths',
      endpoints: {
        start: '/auth/qr/start',
        approve: '/auth/qr/approve',
        status: '/auth/qr/status/:nonce?origin=<origin>',
        contracts: '/auth/qr/contracts',
        sessionContracts: '/auth/qr/session/contracts',
        approveContracts: '/auth/qr/approve/contracts',
        example: '/auth/qr/approve/example',
      },
      tokenHandoff: {
        cookieName: 'bi_session',
        authorizationHeader: 'Bearer <accessToken>',
        statusApprovedFields: ['accessToken', 'tokenType', 'expires_at'],
      },
      entitlementBridge: {
        headedTokenized: '/storefront/entitlement/path?surface=headed&mode=tokenized_access',
        headedDirect: '/storefront/entitlement/path?surface=headed&mode=direct_download',
        downloadEndpoint: '/releases/:releaseId/download',
      },
      pollIntervalMs: QR_POLL_INTERVAL_MS,
      challengeTtlSeconds: parseChallengeTtlSeconds(),
    }));
  });

  app.get('/auth/qr/session/contracts', async (_req, reply) => {
    return reply.status(200).send(ok({
      contractVersion: AUTH_CONTRACT_VERSION,
      authFlow: 'lightning_qr_approve_v1',
      endpoint: '/auth/qr/approve',
      method: 'POST',
      request: {
        required: ['origin', 'pubkey', 'challenge', 'signature'],
        optional: ['challengeHash', 'requestedScopes'],
        challengeShape: '{v,origin,nonce,timestamp}',
      },
      response: {
        fields: ['session', 'accessToken', 'tokenType', 'authFlow', 'challengeVersion', 'challengeHash'],
        sessionFields: ['id', 'pubkey', 'origin', 'scopes', 'created_at', 'expires_at'],
      },
      handoff: {
        cookieName: 'bi_session',
        authorizationHeader: 'Bearer <accessToken>',
        qrStatus: '/auth/qr/status/:nonce?origin=<origin>',
      },
      entitlementBridge: {
        headedDirectPath: '/storefront/entitlement/path?surface=headed&mode=direct_download',
        headedTokenizedPath: '/storefront/entitlement/path?surface=headed&mode=tokenized_access',
        releaseDownload: '/releases/:releaseId/download',
      },
      approveContracts: '/auth/qr/approve/contracts',
      example: '/auth/qr/approve/example',
    }));
  });

  app.get('/auth/qr/status/contracts', async (_req, reply) => {
    return reply.status(200).send(ok({
      contractVersion: AUTH_CONTRACT_VERSION,
      authFlow: 'lightning_qr_approve_v1',
      endpoint: '/auth/qr/status/:nonce?origin=<origin>',
      method: 'GET',
      request: {
        params: { nonce: '0x-prefixed 32-byte hex' },
        query: { origin: 'https://app.example (normalized internally)' },
      },
      statuses: {
        pending: {
          fields: ['status', 'pollAfterMs'],
          pollAfterMs: QR_POLL_INTERVAL_MS,
        },
        approved: {
          fields: ['status', 'accessToken', 'tokenType', 'pubkey', 'approved_at', 'expires_at', 'handoff'],
          handoff: {
            cookieName: 'bi_session',
            authorizationHeader: 'Bearer <accessToken>',
          },
        },
        expired_or_consumed: {
          fields: ['status'],
        },
      },
      usage: {
        pollIntervalMs: QR_POLL_INTERVAL_MS,
        challengeTtlSeconds: parseChallengeTtlSeconds(),
        approveEndpoint: '/auth/qr/approve',
      },
    }));
  });

  app.post('/auth/challenge', async (req, reply) => {
    const parsed = challengeReqSchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.status(400).send(fail('Invalid request body', { issues: parsed.error.issues }));
    }

    let normalizedOrigin: string;
    try {
      normalizedOrigin = normalizeOrigin(parsed.data.origin);
    } catch (e) {
      return sendError(reply, 400, (e as Error).message);
    }

    const challenge = await issueChallenge(normalizedOrigin, req, reply);
    if (!challenge) return;
    return reply.status(200).send(ok({
      challenge,
      challengeTtlSeconds: parseChallengeTtlSeconds(),
      expires_at: challenge.timestamp + parseChallengeTtlSeconds(),
    }));
  });

  app.post('/auth/qr/start', async (req, reply) => {
    const parsed = challengeReqSchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.status(400).send(fail('Invalid request body', { issues: parsed.error.issues }));
    }

    let normalizedOrigin: string;
    try {
      normalizedOrigin = normalizeOrigin(parsed.data.origin);
    } catch (e) {
      return sendError(reply, 400, (e as Error).message);
    }

    const challenge = await issueChallenge(normalizedOrigin, req, reply);
    if (!challenge) return;

    return reply.status(200).send(ok({
      contractVersion: AUTH_CONTRACT_VERSION,
      challenge,
      challengeTtlSeconds: parseChallengeTtlSeconds(),
      expires_at: challenge.timestamp + parseChallengeTtlSeconds(),
      qrPayload: {
        type: 'bitindie-auth-v1',
        challenge,
      },
      lightningUri: buildLightningLoginUri(challenge),
      approve: {
        endpoint: '/auth/qr/approve',
        method: 'POST',
        payloadContract: {
          origin: normalizedOrigin,
          challenge: '{v,origin,nonce,timestamp}',
          pubkey: '0x-prefixed 32-byte hex',
          signature: '0x-prefixed 64-byte hex',
        },
      },
      poll: {
        endpoint: `/auth/qr/status/${challenge.nonce}`,
        method: 'GET',
        intervalMs: QR_POLL_INTERVAL_MS,
        statusValues: ['pending', 'approved', 'expired_or_consumed'],
      },
    }));
  });

  app.get('/auth/qr/status/:nonce', async (req, reply) => {
    const params = req.params as { nonce?: string };
    const query = qrStatusReqSchema.safeParse(req.query);
    if (!query.success) {
      return reply.status(400).send(fail('Invalid request query', { issues: query.error.issues }));
    }

    const nonce = params.nonce ?? '';
    if (!isHex32(nonce)) {
      return sendError(reply, 400, 'nonce must be 0x-prefixed 32-byte hex');
    }

    let normalizedOrigin: string;
    try {
      normalizedOrigin = normalizeOrigin(query.data.origin);
    } catch (e) {
      return sendError(reply, 400, (e as Error).message);
    }

    cleanupQrApprovalCache();
    const approved = qrApprovalCache.get(nonce);
    if (approved) {
      if (approved.origin !== normalizedOrigin) {
        return sendError(reply, 409, 'Challenge origin mismatch');
      }

      return reply.status(200).send(ok({
        status: 'approved',
        accessToken: approved.sessionId,
        tokenType: 'Bearer',
        pubkey: approved.pubkey,
        approved_at: approved.approvedAtUnix,
        expires_at: approved.sessionExpiresAtUnix,
        handoff: {
          cookieName: 'bi_session',
          authorizationHeader: 'Bearer <accessToken>',
        },
      }));
    }

    let pending;
    try {
      pending = await prisma.authChallenge.findUnique({
        where: { origin_nonce: { origin: normalizedOrigin, nonce } },
      });
    } catch (e) {
      return logAndSendError(req, reply, 503, 'Challenge store unavailable', e);
    }

    if (pending && pending.expiresAt.getTime() > Date.now()) {
      return reply.status(200).send(ok({ status: 'pending', pollAfterMs: QR_POLL_INTERVAL_MS }));
    }

    return reply.status(200).send(ok({ status: 'expired_or_consumed' }));
  });

  app.post('/auth/session', async (req, reply) => {
    const parsed = sessionReqSchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.status(400).send(fail('Invalid request body', { issues: parsed.error.issues }));
    }

    return issueSessionFromSignedChallenge(req, reply, parsed.data, {
      setCookie: true,
      includeSessionObject: true,
    });
  });

  app.post('/auth/qr/approve', async (req, reply) => {
    const parsed = sessionReqSchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.status(400).send(fail('Invalid request body', { issues: parsed.error.issues }));
    }

    return issueSessionFromSignedChallenge(req, reply, parsed.data, {
      setCookie: true,
      includeSessionObject: true,
    });
  });

  app.get('/auth/agent/contracts', async (_req, reply) => {
    return reply.status(200).send(ok({
      contractVersion: AUTH_CONTRACT_VERSION,
      challengeEndpoint: '/auth/agent/challenge',
      verifyHashEndpoint: '/auth/agent/verify-hash',
      sessionEndpoint: '/auth/agent/session',
      authFlow: 'signed_challenge_v1',
      signer: {
        curve: 'secp256k1',
        scheme: 'schnorr',
        pubkeyEncoding: '0x-hex-32-byte',
        signatureEncoding: '0x-hex-64-byte',
      },
      challengeHash: {
        algorithm: 'sha256',
        canonicalization: 'json-sorted-keys',
        encoding: '0x-hex-32-byte',
        optionalField: 'challengeHash',
      },
      requestedScopes: {
        field: 'requestedScopes',
        maxItems: 128,
        normalization: 'trim + lowercase + de-duplicate',
      },
      entitlementBridge: {
        tokenType: 'Bearer',
        usage: '/releases/:releaseId/download?accessToken=<accessToken>',
      },
      constructionStatus: '/auth/agent/construction/status',
      challengeFixtureEndpoint: '/auth/agent/challenge/example',
      exampleEndpoint: '/auth/agent/signed-challenge/example',
    }));
  });

  app.get('/auth/agent/construction/status', async (_req, reply) => {
    return reply.status(200).send(ok({
      contractVersion: AUTH_CONTRACT_VERSION,
      phase: 'B',
      title: 'headless signed-challenge auth for agents',
      authFlow: 'signed_challenge_v1',
      readiness: {
        challengeIssue: '/auth/agent/challenge',
        hashPreflight: '/auth/agent/verify-hash',
        sessionIssue: '/auth/agent/session',
        loginManifest: '/auth/agent/login/manifest',
        challengeContracts: '/auth/agent/challenge/contracts',
        challengeFixture: '/auth/agent/challenge/example',
        sessionContracts: '/auth/agent/session/contracts',
        ready: true,
      },
      signer: {
        curve: 'secp256k1',
        scheme: 'schnorr',
        pubkeyEncoding: '0x-hex-32-byte',
        signatureEncoding: '0x-hex-64-byte',
      },
      handoff: {
        tokenType: 'Bearer',
        tokenField: 'accessToken',
        storefrontTokenizedPath: '/storefront/entitlement/path?surface=headless&mode=tokenized_access',
      },
      constraints: {
        challengeTtlSeconds: parseChallengeTtlSeconds(),
        maxChallengeFutureSkewSeconds: MAX_CHALLENGE_FUTURE_SKEW_SECONDS,
        requestedScopesMaxItems: 128,
      },
      previousPhase: {
        phase: 'A',
        endpoint: '/auth/qr/construction/status',
      },
      nextPhase: {
        phase: 'C',
        endpoint: '/storefront/download/contracts',
      },
    }));
  });

  app.get('/auth/agent/session/contracts', async (_req, reply) => {
    return reply.status(200).send(ok({
      contractVersion: AUTH_CONTRACT_VERSION,
      authFlow: 'signed_challenge_v1',
      endpoint: '/auth/agent/session',
      method: 'POST',
      request: {
        required: ['origin', 'pubkey', 'challenge', 'signature'],
        optional: ['challengeHash', 'requestedScopes'],
        challengeShape: '{v,origin,nonce,timestamp}',
      },
      response: {
        tokenType: 'Bearer',
        tokenField: 'accessToken',
        fields: ['accessToken', 'tokenType', 'authFlow', 'challengeVersion', 'challengeHash', 'expires_at'],
      },
      signer: {
        curve: 'secp256k1',
        scheme: 'schnorr',
      },
      challengeHash: {
        algorithm: 'sha256',
        canonicalization: 'json-sorted-keys',
        field: 'challengeHash',
        optional: true,
      },
      entitlementBridge: {
        tokenizedAccessPath: '/storefront/entitlement/path?surface=headless&mode=tokenized_access',
        releaseDownload: '/releases/:releaseId/download',
      },
      example: '/auth/agent/signed-challenge/example',
    }));
  });

  app.get('/auth/agent/challenge/contracts', async (_req, reply) => {
    return reply.status(200).send(ok({
      contractVersion: AUTH_CONTRACT_VERSION,
      authFlow: 'signed_challenge_v1',
      endpoint: '/auth/agent/challenge',
      method: 'POST',
      request: {
        required: ['origin'],
        origin: 'https://agent.example (normalized internally)',
      },
      response: {
        fields: ['challenge', 'challengeTtlSeconds', 'expires_at', 'challengeHashPreview', 'submit', 'verify'],
        challengeShape: '{v,origin,nonce,timestamp}',
        submitEndpoint: '/auth/agent/session',
      },
      challengeHash: {
        algorithm: 'sha256',
        canonicalization: 'json-sorted-keys',
        optionalField: 'challengeHash',
        verifyEndpoint: '/auth/agent/verify-hash',
      },
      entitlementBridge: {
        tokenizedAccessPath: '/storefront/entitlement/path?surface=headless&mode=tokenized_access',
      },
      exampleEndpoint: '/auth/agent/challenge/example',
    }));
  });

  app.get('/auth/agent/challenge/example', async (_req, reply) => {
    return reply.status(200).send(ok({
      contractVersion: AUTH_CONTRACT_VERSION,
      authFlow: 'signed_challenge_v1',
      purpose: 'deterministic challenge issue fixture for headless agents',
      request: {
        endpoint: '/auth/agent/challenge',
        method: 'POST',
        payload: {
          origin: 'https://agent.bitindie.local',
        },
      },
      expectedResponse: {
        requiredFields: ['challenge', 'challengeTtlSeconds', 'expires_at', 'challengeHashPreview', 'submit'],
        submitEndpoint: '/auth/agent/session',
        verifyHashEndpoint: '/auth/agent/verify-hash',
      },
      followup: {
        sessionContracts: '/auth/agent/session/contracts',
        signedChallengeExample: '/auth/agent/signed-challenge/example',
      },
    }));
  });

  app.get('/auth/agent/signed-challenge/example', async (_req, reply) => {
    return reply.status(200).send(ok({
      contractVersion: AUTH_CONTRACT_VERSION,
      authFlow: 'signed_challenge_v1',
      purpose: 'headless-agent-login-and-entitlement-tokenization',
      steps: [
        {
          step: 1,
          action: 'request challenge',
          endpoint: '/auth/agent/challenge',
          payload: { origin: 'https://agent.bitindie.local' },
        },
        {
          step: 2,
          action: 'compute hash + sign challenge',
          details: {
            hash: 'sha256(canonical-json-sorted-keys(challenge))',
            signer: 'secp256k1-schnorr',
          },
        },
        {
          step: 3,
          action: 'exchange signature for access token',
          endpoint: '/auth/agent/session',
          payload: {
            origin: 'https://agent.bitindie.local',
            challenge: '{v,origin,nonce,timestamp}',
            pubkey: '0x-prefixed 32-byte hex',
            signature: '0x-prefixed 64-byte hex',
            challengeHash: 'optional 0x-prefixed 32-byte hex',
            requestedScopes: ['download', 'store:read'],
          },
          responseFields: ['accessToken', 'tokenType', 'expires_at', 'challengeHash'],
        },
        {
          step: 4,
          action: 'use tokenized entitlement path',
          endpoint: '/storefront/entitlement/path?surface=headless&mode=tokenized_access',
        },
        {
          step: 5,
          action: 'download release with bearer token',
          endpoint: '/releases/:releaseId/download',
          authorizationHeader: 'Bearer <accessToken>',
        },
      ],
    }));
  });

  app.get('/auth/agent/login/manifest', async (_req, reply) => {
    return reply.status(200).send(ok({
      contractVersion: AUTH_CONTRACT_VERSION,
      authFlow: 'signed_challenge_v1',
      objective: 'headless signed-challenge auth with bearer tokenized entitlement/download access',
      endpoints: {
        challenge: '/auth/agent/challenge',
        verifyHash: '/auth/agent/verify-hash',
        session: '/auth/agent/session',
        contracts: '/auth/agent/contracts',
        sessionContracts: '/auth/agent/session/contracts',
        challengeFixture: '/auth/agent/challenge/example',
        example: '/auth/agent/signed-challenge/example',
      },
      signer: {
        curve: 'secp256k1',
        scheme: 'schnorr',
        pubkeyEncoding: '0x-hex-32-byte',
        signatureEncoding: '0x-hex-64-byte',
      },
      challengeHash: {
        algorithm: 'sha256',
        canonicalization: 'json-sorted-keys',
        field: 'challengeHash',
        optional: true,
      },
      requestedScopes: {
        field: 'requestedScopes',
        normalization: 'trim + lowercase + de-duplicate',
      },
      tokenHandoff: {
        tokenType: 'Bearer',
        tokenField: 'accessToken',
      },
      entitlementBridge: {
        headlessTokenized: '/storefront/entitlement/path?surface=headless&mode=tokenized_access',
        downloadEndpoint: '/releases/:releaseId/download',
      },
      challengeTtlSeconds: parseChallengeTtlSeconds(),
    }));
  });

  app.post('/auth/agent/challenge', async (req, reply) => {
    const parsed = challengeReqSchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.status(400).send(fail('Invalid request body', { issues: parsed.error.issues }));
    }

    let normalizedOrigin: string;
    try {
      normalizedOrigin = normalizeOrigin(parsed.data.origin);
    } catch (e) {
      return sendError(reply, 400, (e as Error).message);
    }

    const challenge = await issueChallenge(normalizedOrigin, req, reply);
    if (!challenge) return;

    return reply.status(200).send(ok({
      contractVersion: AUTH_CONTRACT_VERSION,
      challenge,
      submit: {
        endpoint: '/auth/agent/session',
        method: 'POST',
        payloadContract: {
          origin: normalizedOrigin,
          challenge: '{v,origin,nonce,timestamp}',
          pubkey: '0x-prefixed 32-byte hex',
          signature: '0x-prefixed 64-byte hex',
          challengeHash: 'optional 0x-prefixed 32-byte hex (must match computed challenge hash)',
        },
      },
      authFlow: 'signed_challenge_v1',
      challengeTtlSeconds: parseChallengeTtlSeconds(),
      expires_at: challenge.timestamp + parseChallengeTtlSeconds(),
      challengeHashPreview: sha256Hex(canonicalJsonStringify(challenge)),
      challengeHash: {
        algorithm: 'sha256',
        canonicalization: 'json-sorted-keys',
        encoding: '0x-hex-32-byte',
      },
      requestedScopes: {
        field: 'requestedScopes',
        maxItems: 128,
        normalization: 'trim + lowercase + de-duplicate',
      },
      verify: {
        contracts: '/auth/agent/contracts',
        challengeHash: '/auth/agent/verify-hash',
        tokenType: 'Bearer',
      },
    }));
  });

  app.get('/auth/storefront/construction/runtime/login-surface-manifest', async (_req, reply) => {
    return reply.status(200).send(ok({
      contractVersion: AUTH_CONTRACT_VERSION,
      version: 'auth-store-login-surface-manifest-v1',
      objective: 'first-class login construction manifest for human QR/approve and headless signed-challenge agent lanes',
      surfaces: {
        humanQrApprove: {
          start: '/auth/qr/start',
          approve: '/auth/qr/approve',
          status: '/auth/qr/status/:nonce?origin=<origin>',
          approveContracts: '/auth/qr/approve/contracts',
          sessionTransport: ['bi_session cookie', 'Authorization: Bearer <accessToken>'],
          storefrontScaffold: '/storefront/scaffold?surface=headed',
          entitlement: {
            directDownload: '/storefront/entitlement/path?surface=headed&mode=direct_download',
            tokenizedAccess: '/storefront/entitlement/path?surface=headed&mode=tokenized_access',
          },
        },
        headlessSignedChallenge: {
          challenge: '/auth/agent/challenge',
          challengeFixture: '/auth/agent/challenge/example',
          verifyHash: '/auth/agent/verify-hash',
          session: '/auth/agent/session',
          authFlow: 'signed_challenge_v1',
          sessionTransport: ['Authorization: Bearer <accessToken>', '?accessToken=<accessToken>'],
          storefrontScaffold: '/storefront/scaffold?surface=headless',
          entitlement: {
            tokenizedAccess: '/storefront/entitlement/path?surface=headless&mode=tokenized_access',
          },
        },
      },
      downstream: {
        storefrontBridge: '/storefront/scaffold/construction/login-entitlement-bridge',
        releaseDownloadSmokeManifest: '/auth/storefront/construction/runtime/release-download-smoke-manifest',
      },
      mergeGates: {
        tests: 'npm test --silent',
        build: 'npm run build --silent',
        mergeMarkerScan: "rg '^(<<<<<<<|=======|>>>>>>>)' src",
      },
    }));
  });

  app.get('/auth/qr/runtime/bootstrap', async (_req, reply) => {
    return reply.status(200).send(ok({
      contractVersion: AUTH_CONTRACT_VERSION,
      version: 'headed-lightning-bootstrap-v1',
      objective: 'implementation-ready bootstrap for human lightning QR login + storefront handoff',
      authFlow: 'lightning_qr_approve_v1',
      sequence: {
        issueChallenge: {
          endpoint: '/auth/qr/start',
          method: 'POST',
          payload: { origin: 'https://app.example' },
          responseFields: ['challenge', 'lightningUri', 'expires_at'],
        },
        walletApprove: {
          endpoint: '/auth/qr/approve',
          method: 'POST',
          payloadContract: {
            origin: 'https://app.example',
            challenge: '{v,origin,nonce,timestamp}',
            pubkey: '0x-prefixed 32-byte hex',
            signature: '0x-prefixed 64-byte hex',
          },
          handoff: {
            cookieName: 'bi_session',
            tokenType: 'Bearer',
            tokenField: 'accessToken',
          },
        },
        pollApproved: {
          endpoint: '/auth/qr/status/:nonce?origin=<origin>',
          statusValues: ['pending', 'approved', 'expired_or_consumed'],
          pollIntervalMs: QR_POLL_INTERVAL_MS,
        },
      },
      storefrontBridge: {
        scaffold: '/storefront/scaffold?surface=headed',
        entitlementPath: '/storefront/entitlement/path?surface=headed&mode=tokenized_access',
        download: '/releases/:releaseId/download',
      },
      constraints: {
        challengeTtlSeconds: parseChallengeTtlSeconds(),
        sessionTtlSeconds: parseSessionTtlSeconds(),
      },
    }));
  });

  app.get('/auth/agent/runtime/bootstrap', async (_req, reply) => {
    return reply.status(200).send(ok({
      contractVersion: AUTH_CONTRACT_VERSION,
      version: 'headless-signed-challenge-bootstrap-v1',
      objective: 'first-class bootstrap for agent signed-challenge auth + tokenized storefront access',
      authFlow: 'signed_challenge_v1',
      sequence: {
        issueChallenge: {
          endpoint: '/auth/agent/challenge',
          method: 'POST',
          payload: { origin: 'https://agent.example' },
          responseFields: ['challenge', 'challengeHashPreview', 'expires_at'],
        },
        optionalVerifyHash: {
          endpoint: '/auth/agent/verify-hash',
          method: 'POST',
          payload: {
            challenge: '{v,origin,nonce,timestamp}',
            challengeHash: '0x-prefixed 32-byte hex',
          },
        },
        mintSession: {
          endpoint: '/auth/agent/session',
          method: 'POST',
          payloadContract: {
            origin: 'https://agent.example',
            challenge: '{v,origin,nonce,timestamp}',
            pubkey: '0x-prefixed 32-byte hex',
            signature: '0x-prefixed 64-byte hex',
            challengeHash: 'optional 0x-prefixed 32-byte hex',
            requestedScopes: ['download', 'store:read'],
          },
          handoff: {
            tokenType: 'Bearer',
            tokenField: 'accessToken',
          },
        },
      },
      storefrontBridge: {
        scaffold: '/storefront/scaffold?surface=headless',
        entitlementPath: '/storefront/entitlement/path?surface=headless&mode=tokenized_access',
        download: '/releases/:releaseId/download',
      },
      constraints: {
        challengeTtlSeconds: parseChallengeTtlSeconds(),
        maxChallengeFutureSkewSeconds: MAX_CHALLENGE_FUTURE_SKEW_SECONDS,
        requestedScopesMaxItems: 128,
      },
    }));
  });

  app.get('/auth/storefront/construction/runtime/priority-checkpoint', async (_req, reply) => {
    return reply.status(200).send(ok({
      mode: 'auth-store-construction',
      version: 'auth-store-priority-checkpoint-v1',
      objective: 'single checkpoint map for priorities A/B/C/D with strict two-wave non-overlap boundaries',
      execution: {
        burstMode: 'two-wave-hybrid',
        wavePairing: [
          ['A', 'B'],
          ['C', 'D'],
        ],
        nonOverlap: 'strict',
      },
      priorities: {
        A: {
          title: 'human lightning login implementation',
          routes: ['/auth/qr/start', '/auth/qr/approve', '/auth/qr/status/:nonce?origin=<origin>'],
          contracts: ['/auth/qr/contracts', '/auth/qr/login/manifest', '/auth/qr/session/contracts'],
          storefrontBridge: '/storefront/entitlement/path?surface=headed&mode=tokenized_access',
        },
        B: {
          title: 'headless signed-challenge auth for agents',
          routes: ['/auth/agent/challenge', '/auth/agent/verify-hash', '/auth/agent/session'],
          contracts: ['/auth/agent/challenge/contracts', '/auth/agent/session/contracts', '/auth/agent/login/manifest'],
          storefrontBridge: '/storefront/entitlement/path?surface=headless&mode=tokenized_access',
        },
        C: {
          title: 'entitlement path support for download + tokenized access',
          routes: ['/storefront/entitlement/path', '/releases/:releaseId/download'],
          contracts: ['/storefront/entitlements', '/storefront/download/contracts', '/storefront/entitlement/surfaces/contracts'],
        },
        D: {
          title: 'storefront scaffolding in parallel lanes',
          routes: ['/storefront/scaffold?surface=headed', '/storefront/scaffold?surface=headless'],
          contracts: ['/storefront/scaffold/contracts', '/storefront/scaffold/surfaces/contracts', '/storefront/scaffold/construction/handoff'],
        },
      },
      mergeGates: {
        tests: 'npm test --silent',
        build: 'npm run build --silent',
        mergeMarkers: "rg -n '^(<<<<<<<|=======|>>>>>>>)' ../../..",
      },
      dependencies: {
        runtimeMap: '/auth/storefront/construction/runtime',
        runtimeExecutionLanes: '/auth/storefront/construction/runtime/execution-lanes',
        storefrontReadiness: '/storefront/scaffold/construction/readiness',
      },
    }));
  });

  app.get('/auth/storefront/construction/runtime/ship-readiness', async (_req, reply) => {
    return reply.status(200).send(ok({
      mode: 'auth-store-construction',
      version: 'auth-store-ship-readiness-v1',
      objective: 'machine-readable wave readiness gate for A/B/C/D auth-to-storefront construction priorities',
      execution: {
        burstMode: 'two-wave-hybrid',
        wavePairing: [
          ['A', 'B'],
          ['C', 'D'],
        ],
        nonOverlap: 'strict',
      },
      readiness: {
        A: {
          title: 'human lightning login implementation',
          ready: true,
          evidence: ['/auth/qr/contracts', '/auth/qr/login/manifest', '/auth/qr/session/contracts'],
        },
        B: {
          title: 'headless signed-challenge auth for agents',
          ready: true,
          evidence: ['/auth/agent/challenge/contracts', '/auth/agent/session/contracts', '/auth/agent/login/manifest'],
        },
        C: {
          title: 'entitlement path support for download + tokenized access',
          ready: true,
          evidence: ['/storefront/entitlements', '/storefront/download/contracts', '/storefront/entitlement/surfaces/contracts'],
        },
        D: {
          title: 'storefront scaffolding in parallel lanes',
          ready: true,
          evidence: ['/storefront/scaffold/contracts', '/storefront/scaffold/surfaces/contracts', '/storefront/scaffold/construction/handoff'],
        },
      },
      mergeGates: {
        tests: 'npm test --silent',
        build: 'npm run build --silent',
        mergeMarkers: "rg -n '^(<<<<<<<|=======|>>>>>>>)' ../../..",
      },
      nextChecks: {
        authRuntime: '/auth/storefront/construction/runtime',
        storefrontReadiness: '/storefront/scaffold/construction/surface-readiness-matrix',
      },
    }));
  });

  app.get('/auth/storefront/construction/runtime/compatibility-guard', async (_req, reply) => {
    const checkpoints = {
      waveAB: {
        ids: ['A', 'B'],
        title: 'login issuance + signed challenge lanes',
        checks: ['/auth/qr/contracts', '/auth/agent/session/contracts'],
        ready: true,
      },
      waveCD: {
        ids: ['C', 'D'],
        title: 'entitlements + storefront scaffold lanes',
        checks: ['/storefront/download/contracts', '/storefront/scaffold/surfaces/contracts'],
        ready: true,
      },
    } as const;

    const checkpointStatus = {
      waveAB: {
        ids: checkpoints.waveAB.ids,
        ready: checkpoints.waveAB.ready,
        blockingReasons: checkpoints.waveAB.ready ? [] : ['missing required A/B contract surfaces'],
      },
      waveCD: {
        ids: checkpoints.waveCD.ids,
        ready: checkpoints.waveCD.ready,
        blockingReasons: checkpoints.waveCD.ready ? [] : ['missing required C/D contract surfaces'],
      },
    } as const;

    const blockingReasons = Object.values(checkpointStatus).flatMap((checkpoint) => checkpoint.blockingReasons);
    const ready = blockingReasons.length === 0;

    return reply.status(200).send(ok({
      mode: 'auth-store-construction',
      version: 'auth-store-compatibility-guard-v1',
      objective: 'single-pass GO/NO_GO guard for 2-wave auth/store construction boundaries',
      burstMode: 'two-wave-hybrid',
      nonOverlap: 'strict',
      ready,
      reason: ready
        ? 'all A/B/C/D boundaries expose required auth + storefront contracts'
        : 'one or more wave boundaries missing required contract surfaces',
      blockingReasons,
      checkpoints,
      checkpointStatus,
      dependencies: {
        shipReadiness: '/auth/storefront/construction/runtime/ship-readiness',
        storefrontReadiness: '/storefront/scaffold/construction/surface-readiness-matrix',
      },
      mergeGates: {
        tests: 'npm test --silent',
        build: 'npm run build --silent',
        mergeMarkers: "rg -n '^(<<<<<<<|=======|>>>>>>>)' ../../..",
      },
    }));
  });

  app.get('/auth/storefront/construction/runtime/execution-receipts', async (_req, reply) => {
    return reply.status(200).send(ok({
      mode: 'auth-store-construction',
      version: 'auth-store-execution-receipts-v1',
      objective: 'copy/paste-ready execution receipts for one strict 2-wave hybrid burst (A/B then C/D)',
      execution: {
        burstMode: 'two-wave-hybrid',
        wavePairing: [
          {
            wave: 'wave-1',
            priorities: ['A', 'B'],
            goal: 'ship human QR login and headless signed-challenge auth in strict non-overlap',
          },
          {
            wave: 'wave-2',
            priorities: ['C', 'D'],
            goal: 'wire entitlement routing + storefront scaffolding contracts after auth lanes are stable',
          },
        ],
        nonOverlap: 'strict',
      },
      receipts: {
        A: {
          lane: 'human-lightning-login',
          start: '/auth/qr/start',
          approve: '/auth/qr/approve',
          status: '/auth/qr/status/:nonce?origin=<origin>',
          sessionContract: '/auth/qr/session/contracts',
        },
        B: {
          lane: 'agent-signed-challenge',
          challenge: '/auth/agent/challenge',
          verifyHash: '/auth/agent/verify-hash',
          session: '/auth/agent/session',
          sessionContract: '/auth/agent/session/contracts',
        },
        C: {
          lane: 'entitlement-path-support',
          direct: '/storefront/entitlement/path?surface=headed&mode=direct_download',
          tokenizedHeaded: '/storefront/entitlement/path?surface=headed&mode=tokenized_access',
          tokenizedHeadless: '/storefront/entitlement/path?surface=headless&mode=tokenized_access',
          download: '/releases/:releaseId/download',
        },
        D: {
          lane: 'storefront-scaffold-surfaces',
          headed: '/storefront/scaffold?surface=headed',
          headless: '/storefront/scaffold?surface=headless',
          contracts: '/storefront/scaffold/surfaces/contracts',
        },
      },
      mergeGates: {
        tests: 'npm test --silent',
        build: 'npm run build --silent',
        mergeMarkers: "rg -n '^(<<<<<<<|=======|>>>>>>>)' ../../..",
      },
      dependencies: {
        compatibilityGuard: '/auth/storefront/construction/runtime/compatibility-guard',
        storefrontReceipts: '/storefront/scaffold/construction/execution-receipts',
      },
    }));
  });

  app.post('/auth/agent/verify-hash', async (req, reply) => {
    const parsed = verifyChallengeHashReqSchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.status(400).send(fail('Invalid request body', { issues: parsed.error.issues }));
    }

    const computed = sha256Hex(canonicalJsonStringify(parsed.data.challenge));
    const provided = parsed.data.challengeHash;

    return reply.status(200).send(ok({
      contractVersion: AUTH_CONTRACT_VERSION,
      matches: computed.toLowerCase() === provided.toLowerCase(),
      computedChallengeHash: computed,
      providedChallengeHash: provided,
      algorithm: 'sha256',
      canonicalization: 'json-sorted-keys',
    }));
  });

  app.post('/auth/agent/session', async (req, reply) => {
    const parsed = sessionReqSchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.status(400).send(fail('Invalid request body', { issues: parsed.error.issues }));
    }

    return issueSessionFromSignedChallenge(req, reply, parsed.data, {
      setCookie: false,
      includeSessionObject: false,
    });
  });
}
