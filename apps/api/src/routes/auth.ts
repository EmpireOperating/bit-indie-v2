import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { randomBytes } from 'node:crypto';
import { z } from 'zod';
import { sha256 } from '@noble/hashes/sha256';
import { schnorr } from '@noble/secp256k1';
import { prisma } from '../prisma.js';
import { fail, ok } from './httpResponses.js';

// --- Types / helpers (keep in sync with Embedded Signer contract) ---

const CHALLENGE_VERSION = 1;

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
  // Minimal normalization:
  // - require scheme + host
  // - lowercase scheme + host
  // - ensure explicit port
  // NOTE: we intentionally reject paths/query/fragments.
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
  // Canonical JSON for v1: stable key ordering.
  // This is sufficient for our fixed challenge shape.
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

// --- Schemas ---

const challengeSchema = z.object({
  v: z.literal(CHALLENGE_VERSION),
  origin: z.string().min(1).max(512),
  nonce: z.string().min(1).max(256),
  timestamp: z.number().int().positive(),
});

const challengeReqSchema = z.object({
  origin: z.string().min(1).max(512),
});

const sessionReqSchema = z.object({
  origin: z.string().min(1).max(512),
  pubkey: z.string().min(1).max(256),
  challenge: challengeSchema,
  signature: z.string().min(1).max(512),
  requestedScopes: z.array(z.any()).max(128).optional(),
});

function parseSessionTtlSeconds(): number {
  const raw = Number(process.env.SESSION_TTL_SECONDS ?? 60 * 60);
  if (!Number.isFinite(raw) || raw <= 0) return 60 * 60;
  return Math.floor(raw);
}

export async function registerAuthRoutes(app: FastifyInstance) {
  // Issue a short-lived challenge.
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

    // Persist pending challenge for replay protection.
    // 5 min window.
    const expiresAt = new Date(Date.now() + 5 * 60 * 1000);

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
        return reply.status(200).send(ok({ challenge }));
      } catch (e: any) {
        // Unique collision on (origin, nonce) is astronomically unlikely; retry a couple times.
        if (e?.code === 'P2002') continue;
        return logAndSendError(req, reply, 503, 'Challenge store unavailable', e);
      }
    }

    return sendError(reply, 503, 'Challenge generation failed');
  });

  // Verify signed challenge and issue a session.
  app.post('/auth/session', async (req, reply) => {
    const parsed = sessionReqSchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.status(400).send(fail('Invalid request body', { issues: parsed.error.issues }));
    }

    const { pubkey, signature, challenge } = parsed.data;

    if (!isHex32(pubkey)) {
      return sendError(reply, 400, 'pubkey must be 0x-prefixed 32-byte hex');
    }
    if (!isHex64(signature)) {
      return sendError(reply, 400, 'signature must be 0x-prefixed 64-byte hex');
    }

    let normalizedOrigin: string;
    try {
      normalizedOrigin = normalizeOrigin(parsed.data.origin);
    } catch (e) {
      return sendError(reply, 400, (e as Error).message);
    }

    if (challenge.origin !== normalizedOrigin) {
      return sendError(reply, 400, 'Challenge origin mismatch');
    }

    // Check challenge pending + not expired + not consumed.
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
      // Best-effort cleanup.
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

    // Verify signature.
    const json = canonicalJsonStringify(challenge);
    const hash = sha256Hex(json);

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

    // Consume challenge (replay protection).
    try {
      await prisma.authChallenge.delete({ where: { id: pending.id } });
    } catch (e) {
      return logAndSendError(req, reply, 503, 'Challenge store unavailable', e);
    }

    const ttlSeconds = parseSessionTtlSeconds();
    const expiresAt = new Date(Date.now() + ttlSeconds * 1000);

    let session;
    try {
      session = await prisma.apiSession.create({
        data: {
          pubkey,
          origin: normalizedOrigin,
          scopesJson: parsed.data.requestedScopes ?? [],
          expiresAt,
        },
      });

      // Create or ensure user exists.
      await prisma.user.upsert({
        where: { pubkey },
        create: { pubkey },
        update: {},
      });
    } catch (e) {
      return logAndSendError(req, reply, 503, 'Session store unavailable', e);
    }

    // Cookie for browser UX.
    reply.setCookie('bi_session', session.id, {
      path: '/',
      httpOnly: true,
      sameSite: 'lax',
      secure: process.env.COOKIE_SECURE === 'true',
    });

    // Bearer token for headless agents.
    // v1: use the session id as an opaque access token.
    const accessToken = session.id;

    return reply.status(201).send(ok({
      session: {
        id: session.id,
        pubkey: session.pubkey,
        origin: session.origin,
        scopes: session.scopesJson,
        created_at: Math.floor(session.createdAt.getTime() / 1000),
        expires_at: Math.floor(session.expiresAt.getTime() / 1000),
      },
      accessToken,
      tokenType: 'Bearer',
    }));
  });
}
