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

export async function getSessionById(sessionId: string): Promise<ApiSession | null> {
  return prisma.apiSession.findUnique({ where: { id: sessionId } });
}

export async function requireSession(req: FastifyRequest, reply: FastifyReply): Promise<ApiSession | null> {
  const authz = String(req.headers.authorization ?? '').trim();
  let sessionId: string | null = null;

  if (authz.toLowerCase().startsWith('bearer ')) {
    sessionId = authz.slice('bearer '.length).trim();
  } else if (typeof (req as any).cookies?.bi_session === 'string') {
    sessionId = (req as any).cookies.bi_session;
  }

  if (!sessionId) {
    reply.status(401).send({ ok: false, error: 'Unauthorized' });
    return null;
  }

  const session = await getSessionById(sessionId);
  if (!session) {
    reply.status(401).send({ ok: false, error: 'Invalid session' });
    return null;
  }

  if (session.expiresAt.getTime() < Date.now()) {
    reply.status(401).send({ ok: false, error: 'Session expired' });
    return null;
  }

  return session;
}
