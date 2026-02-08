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
        },
        fallback: {
          challenge: '/auth/challenge',
          session: '/auth/session',
          cookieName: 'bi_session',
        },
      },
      headless: {
        challenge: '/auth/agent/challenge',
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
        endpoint: '/auth/agent/contracts',
        tokenType: 'Bearer',
      },
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
