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
          tokenizedEndpoint: '/releases/:releaseId/download?accessToken=<accessToken>',
          authorizationHeader: 'Bearer <accessToken>',
          cookieToken: 'bi_session',
          entitlementInputs: ['buyerUserId', 'guestReceiptCode', 'accessToken'],
        },
        storefront: {
          scaffold: '/storefront/scaffold?surface=headed',
          surface: 'headed',
          lanes: {
            auth: '/auth/qr/start|/auth/qr/approve|/auth/qr/status/:nonce',
            entitlement: '/releases/:releaseId/download?buyerUserId=<id>|guestReceiptCode=<code>|accessToken=<accessToken>',
            tokenized: '/releases/:releaseId/download (Authorization: Bearer <accessToken> or bi_session cookie)',
          },
        },
      },
      headless: {
        auth: {
          challenge: '/auth/agent/challenge',
          session: '/auth/agent/session',
          tokenField: 'accessToken',
          authorizationHeader: 'Bearer <accessToken>',
          signer: 'secp256k1-schnorr',
          challengeVersion: 1,
        },
        download: {
          endpoint: '/releases/:releaseId/download',
          tokenizedEndpoint: '/releases/:releaseId/download?accessToken=<accessToken>',
          authorizationHeader: 'Bearer <accessToken>',
          entitlementInputs: ['accessToken', 'buyerUserId', 'guestReceiptCode'],
        },
        storefront: {
          scaffold: '/storefront/scaffold?surface=headless',
          surface: 'headless',
          lanes: {
            auth: '/auth/agent/challenge|/auth/agent/session',
            entitlement: '/releases/:releaseId/download?accessToken=<accessToken>',
            tokenized: '/releases/:releaseId/download (Authorization: Bearer <accessToken>)',
          },
        },
      },
    }));
  });

  app.get('/storefront/scaffold', async (req, reply) => {
    const query = req.query as { surface?: string };
    const surface = query.surface === 'headless' ? 'headless' : 'headed';

    if (surface === 'headless') {
      return reply.status(200).send(ok({
        surface,
        authContract: {
          challenge: '/auth/agent/challenge',
          session: '/auth/agent/session',
          tokenField: 'accessToken',
        },
        entitlementContract: {
          releaseDownload: '/releases/:releaseId/download',
          tokenizedAccess: {
            query: '?accessToken=<accessToken>',
            authorizationHeader: 'Bearer <accessToken>',
          },
          supports: ['tokenized_access'],
        },
        storefrontLane: {
          contracts: '/storefront/contracts',
          releasesDownload: '/releases/:releaseId/download?accessToken=<accessToken>',
        },
      }));
    }

    return reply.status(200).send(ok({
      surface,
      authContract: {
        qrStart: '/auth/qr/start',
        qrApprove: '/auth/qr/approve',
        qrStatus: '/auth/qr/status/:nonce?origin=<origin>',
        cookieName: 'bi_session',
      },
      entitlementContract: {
        releaseDownload: '/releases/:releaseId/download',
        directAccess: ['?buyerUserId=<id>', '?guestReceiptCode=<code>'],
        tokenizedAccess: {
          query: '?accessToken=<accessToken>',
          authorizationHeader: 'Bearer <accessToken>',
          cookie: 'bi_session=<accessToken>',
        },
        supports: ['direct_download', 'tokenized_access'],
      },
      storefrontLane: {
        contracts: '/storefront/contracts',
        releasesDownload: '/releases/:releaseId/download',
      },
    }));
  });
}
