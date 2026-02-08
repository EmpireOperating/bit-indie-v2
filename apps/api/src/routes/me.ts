import type { FastifyInstance } from 'fastify';
import { requireSession } from '../auth/session.js';
import { ok } from './httpResponses.js';

function sessionExpiryIso(expiresAt: Date): string {
  return expiresAt.toISOString();
}

function serializeSession(session: {
  pubkey: string;
  origin: string;
  scopesJson: unknown;
  id: string;
  expiresAt: Date;
}) {
  return {
    pubkey: session.pubkey,
    origin: session.origin,
    scopes: session.scopesJson,
    sessionId: session.id,
    expiresAt: sessionExpiryIso(session.expiresAt),
  };
}

function meResponsePayload(session: {
  pubkey: string;
  origin: string;
  scopesJson: unknown;
  id: string;
  expiresAt: Date;
}) {
  return ok(serializeSession(session));
}

export async function registerMeRoutes(app: FastifyInstance) {
  app.get('/me', async (req, reply) => {
    const session = await requireSession(req, reply);
    if (!session) return;

    return reply.status(200).send(meResponsePayload(session));
  });
}
