import type { FastifyInstance } from 'fastify';
import { ok } from './httpResponses.js';

export async function registerStorefrontRoutes(app: FastifyInstance) {
  app.get('/storefront/contracts', async (_req, reply) => {
    return reply.status(200).send(ok({
      headed: {
        login: {
          challenge: '/auth/challenge',
          session: '/auth/session',
          cookieName: 'bi_session',
          recommendedFlow: 'challenge-sign-session-cookie',
        },
        download: {
          endpoint: '/releases/:releaseId/download',
          entitlementInputs: ['buyerUserId', 'guestReceiptCode'],
        },
      },
      headless: {
        auth: {
          challenge: '/auth/challenge',
          session: '/auth/session',
          tokenField: 'accessToken',
          authorizationHeader: 'Bearer <accessToken>',
        },
        download: {
          endpoint: '/releases/:releaseId/download',
          entitlementInputs: ['accessToken', 'buyerUserId', 'guestReceiptCode'],
        },
      },
    }));
  });
}
