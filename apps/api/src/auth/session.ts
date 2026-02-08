import type { FastifyReply, FastifyRequest } from 'fastify';
import { prisma } from '../prisma.js';

export type ApiSession = {
  id: string;
  pubkey: string;
  origin: string;
  scopesJson: unknown;
  expiresAt: Date;
  createdAt: Date;
};

const UUID_LIKE_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function extractSessionId(req: FastifyRequest): string | null {
  const authzRaw = req.headers.authorization;
  const authz = typeof authzRaw === 'string' ? authzRaw.trim() : '';

  if (authz.toLowerCase().startsWith('bearer ')) {
    const token = authz.slice('bearer '.length).trim();
    return token.length > 0 ? token : null;
  }

  const cookieSession = (req as any).cookies?.bi_session;
  return typeof cookieSession === 'string' && cookieSession.trim().length > 0
    ? cookieSession.trim()
    : null;
}

export async function getSessionById(sessionId: string): Promise<ApiSession | null> {
  return prisma.apiSession.findUnique({ where: { id: sessionId } });
}

export async function requireSession(req: FastifyRequest, reply: FastifyReply): Promise<ApiSession | null> {
  const sessionId = extractSessionId(req);

  if (!sessionId) {
    reply.status(401).send({ ok: false, error: 'Unauthorized' });
    return null;
  }

  // v1 session ids are UUIDs; reject obviously malformed tokens early.
  if (!UUID_LIKE_RE.test(sessionId)) {
    reply.status(401).send({ ok: false, error: 'Invalid session' });
    return null;
  }

  let session: ApiSession | null;
  try {
    session = await getSessionById(sessionId);
  } catch {
    reply.status(503).send({ ok: false, error: 'Session store unavailable' });
    return null;
  }

  if (!session) {
    reply.status(401).send({ ok: false, error: 'Invalid session' });
    return null;
  }

  if (session.expiresAt.getTime() <= Date.now()) {
    reply.status(401).send({ ok: false, error: 'Session expired' });
    return null;
  }

  return session;
}
