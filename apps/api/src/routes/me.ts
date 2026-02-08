import type { FastifyInstance } from 'fastify';
import { requireSession } from '../auth/session.js';
import { ok } from './httpResponses.js';

export async function registerMeRoutes(app: FastifyInstance) {
  app.get('/me', async (req, reply) => {
    const session = await requireSession(req, reply);
    if (!session) return;

    return reply.status(200).send(ok({
      pubkey: session.pubkey,
      origin: session.origin,
      scopes: session.scopesJson,
      sessionId: session.id,
      expiresAt: session.expiresAt.toISOString(),
    }));
  });
}
