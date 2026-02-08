import type { FastifyInstance } from 'fastify';
import { ok } from './httpResponses.js';

export async function registerStorefrontRoutes(app: FastifyInstance) {
  app.get('/storefront/contracts', async (_req, reply) => {
    return reply.status(200).send(ok({
      headed: {
        login: {
          qrStart: '/auth/qr/start',
          qrStatus: '/auth/qr/status/:nonce?origin=<origin>',
          challenge: '/auth/challenge',
          session: '/auth/session',
          cookieName: 'bi_session',
          recommendedFlow: 'qr-start-scan-approve-poll',
          fallbackFlow: 'challenge-sign-session-cookie',
        },
        download: {
          endpoint: '/releases/:releaseId/download',
          entitlementInputs: ['buyerUserId', 'guestReceiptCode', 'accessToken'],
        },
      },
      headless: {
        auth: {
          challenge: '/auth/challenge',
          session: '/auth/agent/session',
          tokenField: 'accessToken',
          authorizationHeader: 'Bearer <accessToken>',
          signer: 'secp256k1-schnorr',
          challengeVersion: 1,
        },
        download: {
          endpoint: '/releases/:releaseId/download',
          entitlementInputs: ['accessToken', 'buyerUserId', 'guestReceiptCode'],
        },
      },
    }));
  });
}
