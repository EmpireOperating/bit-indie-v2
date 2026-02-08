import type { FastifyInstance } from 'fastify';
import { ok } from './httpResponses.js';

export async function registerStorefrontRoutes(app: FastifyInstance) {
  app.get('/storefront/lanes', async (_req, reply) => {
    return reply.status(200).send(ok({
      executionModel: 'hybrid',
      strictNonOverlap: true,
      lanes: {
        headed: {
          auth: {
            start: '/auth/qr/start',
            approve: '/auth/qr/approve',
            pollStatus: '/auth/qr/status/:nonce?origin=<origin>',
          },
          entitlement: {
            releaseDownload: '/releases/:releaseId/download',
            directAccess: ['buyerUserId', 'guestReceiptCode'],
            tokenizedAccess: {
              query: '?accessToken=<accessToken>',
              authorizationHeader: 'Bearer <accessToken>',
              cookie: 'bi_session=<accessToken>',
            },
          },
        },
        headless: {
          auth: {
            challenge: '/auth/agent/challenge',
            session: '/auth/agent/session',
            authFlow: 'signed_challenge_v1',
          },
          entitlement: {
            releaseDownload: '/releases/:releaseId/download',
            tokenizedAccess: {
              query: '?accessToken=<accessToken>',
              authorizationHeader: 'Bearer <accessToken>',
            },
          },
        },
      },
    }));
  });

  app.get('/storefront/contracts', async (_req, reply) => {
    return reply.status(200).send(ok({
      headed: {
        login: {
          qrStart: '/auth/qr/start',
          qrApprove: '/auth/qr/approve',
          qrStatus: '/auth/qr/status/:nonce?origin=<origin>',
          qrStatusValues: ['pending', 'approved', 'expired_or_consumed'],
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
          signatureEncoding: '0x-hex-64-byte',
          pubkeyEncoding: '0x-hex-32-byte',
          challengeVersion: 1,
          challengeHash: {
            algorithm: 'sha256',
            canonicalization: 'json-sorted-keys',
            encoding: '0x-hex-32-byte',
          },
          optionalChallengeHashField: 'challengeHash',
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

  app.get('/storefront/entitlements', async (_req, reply) => {
    return reply.status(200).send(ok({
      contracts: {
        download: {
          endpoint: '/releases/:releaseId/download',
          modes: {
            direct: ['buyerUserId', 'guestReceiptCode'],
            tokenized: {
              query: '?accessToken=<accessToken>',
              authorizationHeader: 'Bearer <accessToken>',
              cookie: 'bi_session=<accessToken>',
            },
          },
        },
      },
      surfaces: {
        headed: {
          supports: ['direct_download', 'tokenized_access'],
          authGate: '/auth/qr/start|/auth/qr/approve|/auth/qr/status/:nonce',
        },
        headless: {
          supports: ['tokenized_access'],
          authGate: '/auth/agent/challenge|/auth/agent/session',
        },
      },
    }));
  });

  app.get('/storefront/entitlement/path', async (req, reply) => {
    const query = req.query as { surface?: string; mode?: string };
    const surface = query.surface === 'headless' ? 'headless' : 'headed';
    const mode = query.mode === 'tokenized_access' ? 'tokenized_access' : 'direct_download';

    if (surface === 'headless' && mode === 'direct_download') {
      return reply.status(409).send(ok({
        surface,
        mode,
        supported: false,
        reason: 'headless surface requires tokenized_access',
        fallback: '/storefront/entitlement/path?surface=headless&mode=tokenized_access',
      }));
    }

    return reply.status(200).send(ok({
      surface,
      mode,
      supported: true,
      endpoint: '/releases/:releaseId/download',
      requirements:
        mode === 'tokenized_access'
          ? {
              query: '?accessToken=<accessToken>',
              authorizationHeader: 'Bearer <accessToken>',
              cookie: surface === 'headed' ? 'bi_session=<accessToken>' : null,
            }
          : {
              direct: ['buyerUserId', 'guestReceiptCode'],
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
          laneScaffold: {
            auth: '/auth/agent/challenge|/auth/agent/session',
            entitlement: '/storefront/entitlement/path?surface=headless&mode=tokenized_access',
          },
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
        laneScaffold: {
          auth: '/auth/qr/start|/auth/qr/approve|/auth/qr/status/:nonce',
          entitlement: '/storefront/entitlement/path?surface=headed&mode=direct_download|tokenized_access',
        },
      },
    }));
  });
}
