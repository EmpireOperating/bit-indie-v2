import type { FastifyInstance } from 'fastify';
import { ok } from './httpResponses.js';

const STOREFRONT_CONTRACT_VERSION = 'storefront-contract-v3';
const AUTH_CONTRACT_VERSION = 'auth-contract-v3';

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
            contracts: '/auth/agent/contracts',
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
      contractVersion: STOREFRONT_CONTRACT_VERSION,
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
          contracts: '/auth/agent/contracts',
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


  app.get('/storefront/download/contracts', async (_req, reply) => {
    return reply.status(200).send(ok({
      contractVersion: STOREFRONT_CONTRACT_VERSION,
      objective: 'first-class entitlement path support for direct download and tokenized access',
      endpoint: '/releases/:releaseId/download',
      modes: {
        direct_download: {
          fields: ['buyerUserId', 'guestReceiptCode'],
          supportedSurfaces: ['headed'],
          path: '/storefront/entitlement/path?surface=headed&mode=direct_download',
        },
        tokenized_access: {
          query: '?accessToken=<accessToken>',
          authorizationHeader: 'Bearer <accessToken>',
          headedCookie: 'bi_session=<accessToken>',
          supportedSurfaces: ['headed', 'headless'],
          headedPath: '/storefront/entitlement/path?surface=headed&mode=tokenized_access',
          headlessPath: '/storefront/entitlement/path?surface=headless&mode=tokenized_access',
        },
      },
      examples: '/storefront/entitlement/examples',
    }));
  });

  app.get('/storefront/entitlement/examples', async (_req, reply) => {
    return reply.status(200).send(ok({
      endpoint: '/releases/:releaseId/download',
      headed: {
        directDownload: {
          buyerUserId: '/releases/:releaseId/download?buyerUserId=<buyerUserId>',
          guestReceiptCode: '/releases/:releaseId/download?guestReceiptCode=<guestReceiptCode>',
        },
        tokenizedAccess: {
          query: '/releases/:releaseId/download?accessToken=<accessToken>',
          authorizationHeader: 'Authorization: Bearer <accessToken>',
          cookie: 'Cookie: bi_session=<accessToken>',
        },
      },
      headless: {
        tokenizedAccess: {
          query: '/releases/:releaseId/download?accessToken=<accessToken>',
          authorizationHeader: 'Authorization: Bearer <accessToken>',
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
          contracts: '/auth/agent/contracts',
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
            auth: '/auth/agent/challenge|/auth/agent/session|/auth/agent/contracts',
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


  app.get('/storefront/scaffold/contracts', async (_req, reply) => {
    return reply.status(200).send(ok({
      version: 'storefront-scaffold-contracts-v1',
      contractVersion: STOREFRONT_CONTRACT_VERSION,
      authContractVersion: AUTH_CONTRACT_VERSION,
      objective: 'first-class headed + headless scaffold contract surfaces for parallel storefront lanes',
      surfaces: {
        headed: {
          authManifest: '/auth/qr/login/manifest',
          authContracts: '/auth/qr/contracts',
          scaffold: '/storefront/scaffold?surface=headed',
          entitlementModes: {
            directDownload: '/storefront/entitlement/path?surface=headed&mode=direct_download',
            tokenizedAccess: '/storefront/entitlement/path?surface=headed&mode=tokenized_access',
          },
          bootstrap: '/storefront/bootstrap/auth-store',
        },
        headless: {
          authManifest: '/auth/agent/login/manifest',
          authContracts: '/auth/agent/contracts',
          scaffold: '/storefront/scaffold?surface=headless',
          entitlementModes: {
            tokenizedAccess: '/storefront/entitlement/path?surface=headless&mode=tokenized_access',
          },
          bootstrap: '/storefront/bootstrap/auth-store',
        },
      },
      shared: {
        contracts: '/storefront/contracts',
        lanes: '/storefront/lanes',
        playbook: '/storefront/playbook/login-to-entitlement',
        downloadContracts: '/storefront/download/contracts',
        surfaceContracts: '/storefront/scaffold/surfaces/contracts',
      },
    }));
  });

  app.get('/storefront/scaffold/surfaces/contracts', async (_req, reply) => {
    return reply.status(200).send(ok({
      version: 'storefront-surface-contracts-v1',
      contractVersion: STOREFRONT_CONTRACT_VERSION,
      objective: 'parallel headed + headless storefront contract surfaces with first-class auth/session handoff references',
      headed: {
        scaffold: '/storefront/scaffold?surface=headed',
        authContracts: '/auth/qr/contracts',
        authSessionContracts: '/auth/qr/session/contracts',
        loginManifest: '/auth/qr/login/manifest',
        entitlement: {
          direct: '/storefront/entitlement/path?surface=headed&mode=direct_download',
          tokenized: '/storefront/entitlement/path?surface=headed&mode=tokenized_access',
          downloadContracts: '/storefront/download/contracts',
        },
      },
      headless: {
        scaffold: '/storefront/scaffold?surface=headless',
        authContracts: '/auth/agent/contracts',
        authSessionContracts: '/auth/agent/session/contracts',
        loginManifest: '/auth/agent/login/manifest',
        entitlement: {
          tokenized: '/storefront/entitlement/path?surface=headless&mode=tokenized_access',
          downloadContracts: '/storefront/download/contracts',
        },
      },
      shared: {
        bootstrap: '/storefront/bootstrap/auth-store',
        scaffoldContracts: '/storefront/scaffold/contracts',
        playbook: '/storefront/playbook/login-to-entitlement',
      },
    }));
  });

  app.get('/storefront/scaffold/manifest', async (_req, reply) => {
    return reply.status(200).send(ok({
      version: 'auth-store-v3',
      contractVersion: STOREFRONT_CONTRACT_VERSION,
      authContractVersion: AUTH_CONTRACT_VERSION,
      generatedBy: 'storefront-contract-surface',
      surfaces: {
        headed: '/storefront/scaffold?surface=headed',
        headless: '/storefront/scaffold?surface=headless',
      },
      contracts: '/storefront/contracts',
      entitlements: {
        matrix: '/storefront/entitlements',
        headedDownload: '/storefront/entitlement/path?surface=headed&mode=direct_download',
        headedTokenized: '/storefront/entitlement/path?surface=headed&mode=tokenized_access',
        headlessTokenized: '/storefront/entitlement/path?surface=headless&mode=tokenized_access',
        examples: '/storefront/entitlement/examples',
      },
      auth: {
        humanQrStart: '/auth/qr/start',
        humanQrApprove: '/auth/qr/approve',
        humanQrStatus: '/auth/qr/status/:nonce?origin=<origin>',
        agentChallenge: '/auth/agent/challenge',
        agentSession: '/auth/agent/session',
        agentContracts: '/auth/agent/contracts',
      },
      handoffPlaybook: '/storefront/playbook/login-to-entitlement',
      bootstrap: '/storefront/bootstrap/auth-store',
      scaffoldContracts: '/storefront/scaffold/contracts',
      surfaceContracts: '/storefront/scaffold/surfaces/contracts',
      downloadContracts: '/storefront/download/contracts',
    }));
  });

  app.get('/storefront/bootstrap/auth-store', async (_req, reply) => {
    return reply.status(200).send(ok({
      version: 'auth-store-bootstrap-v1',
      contractVersion: STOREFRONT_CONTRACT_VERSION,
      objective: 'start headed + headless storefront construction with non-overlapping lanes',
      laneOrder: [
        'headed-human-lightning-login',
        'headless-signed-challenge-auth',
        'shared-entitlement-paths',
        'storefront-surface-scaffolding',
      ],
      headed: {
        login: {
          contracts: '/auth/qr/contracts',
          start: '/auth/qr/start',
          approve: '/auth/qr/approve',
          poll: '/auth/qr/status/:nonce?origin=<origin>',
          example: '/auth/qr/approve/example',
        },
        entitlements: {
          direct: '/storefront/entitlement/path?surface=headed&mode=direct_download',
          tokenized: '/storefront/entitlement/path?surface=headed&mode=tokenized_access',
        },
      },
      headless: {
        login: {
          contracts: '/auth/agent/contracts',
          challenge: '/auth/agent/challenge',
          session: '/auth/agent/session',
          example: '/auth/agent/signed-challenge/example',
        },
        entitlements: {
          tokenized: '/storefront/entitlement/path?surface=headless&mode=tokenized_access',
        },
      },
      storefront: {
        contracts: '/storefront/contracts',
        lanes: '/storefront/lanes',
        scaffoldManifest: '/storefront/scaffold/manifest',
        scaffoldContracts: '/storefront/scaffold/contracts',
        playbook: '/storefront/playbook/login-to-entitlement',
        downloadContracts: '/storefront/download/contracts',
      },
    }));
  });

  app.get('/storefront/contracts/auth-store/surfaces', async (_req, reply) => {
    return reply.status(200).send(ok({
      contractVersion: STOREFRONT_CONTRACT_VERSION,
      objective: 'first-class auth + storefront contract handoff surfaces for headed and headless lanes',
      headed: {
        authSessionContracts: '/auth/session/contracts/surfaces',
        loginManifest: '/auth/qr/login/manifest',
        scaffold: '/storefront/scaffold?surface=headed',
        entitlement: {
          direct: '/storefront/entitlement/path?surface=headed&mode=direct_download',
          tokenized: '/storefront/entitlement/path?surface=headed&mode=tokenized_access',
        },
      },
      headless: {
        authSessionContracts: '/auth/session/contracts/surfaces',
        loginManifest: '/auth/agent/login/manifest',
        scaffold: '/storefront/scaffold?surface=headless',
        entitlement: {
          tokenized: '/storefront/entitlement/path?surface=headless&mode=tokenized_access',
        },
      },
      shared: {
        scaffoldManifest: '/storefront/scaffold/manifest',
        scaffoldContracts: '/storefront/scaffold/contracts',
        bootstrap: '/storefront/bootstrap/auth-store',
        playbook: '/storefront/playbook/login-to-entitlement',
      },
    }));
  });

  app.get('/storefront/scaffold/parallel-lanes/manifest', async (_req, reply) => {
    return reply.status(200).send(ok({
      version: 'storefront-parallel-lanes-v1',
      contractVersion: STOREFRONT_CONTRACT_VERSION,
      objective: 'parallel headed + headless storefront scaffolding lanes with strict non-overlap boundaries',
      laneOrder: [
        'headed-human-login-surface',
        'headless-agent-auth-surface',
        'shared-entitlement-paths',
        'shared-storefront-shell',
      ],
      lanes: {
        headed: {
          scaffold: '/storefront/scaffold?surface=headed',
          authManifest: '/auth/qr/login/manifest',
          authConstructionManifest: '/auth/login/construction/manifest',
          entitlementModes: {
            direct: '/storefront/entitlement/path?surface=headed&mode=direct_download',
            tokenized: '/storefront/entitlement/path?surface=headed&mode=tokenized_access',
          },
        },
        headless: {
          scaffold: '/storefront/scaffold?surface=headless',
          authManifest: '/auth/agent/login/manifest',
          authConstructionManifest: '/auth/login/construction/manifest',
          entitlementModes: {
            tokenized: '/storefront/entitlement/path?surface=headless&mode=tokenized_access',
          },
        },
      },
      shared: {
        authStoreSurfaces: '/storefront/contracts/auth-store/surfaces',
        scaffoldSurfacesContracts: '/storefront/scaffold/surfaces/contracts',
        downloadContracts: '/storefront/download/contracts',
        playbook: '/storefront/playbook/login-to-entitlement',
      },
    }));
  });

  app.get('/storefront/scaffold/construction/checklist', async (_req, reply) => {
    return reply.status(200).send(ok({
      version: 'storefront-construction-checklist-v1',
      contractVersion: STOREFRONT_CONTRACT_VERSION,
      objective: 'single checklist to execute auth/store construction without lane overlap',
      priorities: {
        A: {
          title: 'human lightning login implementation',
          manifest: '/auth/qr/login/manifest',
          contracts: '/auth/qr/contracts',
          handoff: '/auth/qr/session/contracts',
        },
        B: {
          title: 'headless signed-challenge auth',
          manifest: '/auth/agent/login/manifest',
          contracts: '/auth/agent/contracts',
          handoff: '/auth/agent/session/contracts',
        },
        C: {
          title: 'entitlement path coverage (download + tokenized access)',
          contracts: '/storefront/download/contracts',
          paths: [
            '/storefront/entitlement/path?surface=headed&mode=direct_download',
            '/storefront/entitlement/path?surface=headed&mode=tokenized_access',
            '/storefront/entitlement/path?surface=headless&mode=tokenized_access',
          ],
        },
        D: {
          title: 'parallel storefront scaffolding surfaces',
          manifest: '/storefront/scaffold/parallel-lanes/manifest',
          surfaces: '/storefront/scaffold/surfaces/contracts',
          authStoreSurfaces: '/storefront/contracts/auth-store/surfaces',
        },
      },
      gates: {
        tests: 'npm test --silent',
        build: 'npm run build --silent',
        mergeMarkerScan: 'rg "^(<<<<<<<|=======|>>>>>>>)" src || true',
      },
    }));
  });

  app.get('/storefront/scaffold/construction/readiness', async (_req, reply) => {
    return reply.status(200).send(ok({
      version: 'storefront-construction-readiness-v1',
      contractVersion: STOREFRONT_CONTRACT_VERSION,
      objective: 'single readiness snapshot for auth/store construction priorities',
      priorities: {
        A: {
          title: 'human lightning login implementation',
          ready: true,
          contracts: ['/auth/qr/contracts', '/auth/qr/login/manifest', '/auth/qr/session/contracts'],
        },
        B: {
          title: 'headless signed-challenge auth for agents',
          ready: true,
          contracts: ['/auth/agent/contracts', '/auth/agent/login/manifest', '/auth/agent/session/contracts'],
        },
        C: {
          title: 'entitlement path support (download + tokenized access)',
          ready: true,
          contracts: ['/storefront/download/contracts', '/storefront/entitlement/path?surface=headed&mode=direct_download', '/storefront/entitlement/path?surface=headed&mode=tokenized_access', '/storefront/entitlement/path?surface=headless&mode=tokenized_access'],
        },
        D: {
          title: 'parallel storefront scaffolding surfaces',
          ready: true,
          contracts: ['/storefront/scaffold/parallel-lanes/manifest', '/storefront/scaffold/surfaces/contracts', '/storefront/contracts/auth-store/surfaces'],
        },
      },
      mergeGates: {
        test: 'npm test --silent',
        build: 'npm run build --silent',
        mergeMarkerScan: 'rg "^(<<<<<<<|=======|>>>>>>>)" src || true',
      },
    }));
  });

  app.get('/storefront/scaffold/construction/handoff', async (_req, reply) => {
    return reply.status(200).send(ok({
      version: 'storefront-construction-handoff-v1',
      contractVersion: STOREFRONT_CONTRACT_VERSION,
      objective: 'implementation-backed handoff map from login lanes to entitlement paths',
      priorities: {
        A: {
          lane: 'human-lightning-login',
          start: '/auth/qr/start',
          approve: '/auth/qr/approve',
          status: '/auth/qr/status/:nonce?origin=<origin>',
          sessionContract: '/auth/qr/session/contracts',
        },
        B: {
          lane: 'headless-signed-challenge',
          challenge: '/auth/agent/challenge',
          session: '/auth/agent/session',
          verifyHash: '/auth/agent/verify-hash',
          sessionContract: '/auth/agent/session/contracts',
        },
        C: {
          lane: 'entitlement-paths',
          headedDirect: '/storefront/entitlement/path?surface=headed&mode=direct_download',
          headedTokenized: '/storefront/entitlement/path?surface=headed&mode=tokenized_access',
          headlessTokenized: '/storefront/entitlement/path?surface=headless&mode=tokenized_access',
          downloadContracts: '/storefront/download/contracts',
        },
        D: {
          lane: 'parallel-storefront-scaffolding',
          headedScaffold: '/storefront/scaffold?surface=headed',
          headlessScaffold: '/storefront/scaffold?surface=headless',
          laneManifest: '/storefront/scaffold/parallel-lanes/manifest',
        },
      },
      authRuntimeMap: '/auth/storefront/construction/runtime',
      mergeGates: {
        test: 'npm test --silent',
        build: 'npm run build --silent',
        mergeMarkerScan: 'rg "^(<<<<<<<|=======|>>>>>>>)" src || true',
      },
    }));
  });

  app.get('/storefront/scaffold/construction/entitlement-consumption', async (_req, reply) => {
    return reply.status(200).send(ok({
      version: 'storefront-entitlement-consumption-v1',
      contractVersion: STOREFRONT_CONTRACT_VERSION,
      authContractVersion: AUTH_CONTRACT_VERSION,
      objective: 'consumption path contract for headed and headless lanes after auth session handoff',
      runtimeBridge: {
        authRuntime: '/auth/storefront/construction/runtime',
        authLifecycle: '/auth/storefront/construction/runtime/session-lifecycle',
        storefrontHandoff: '/storefront/scaffold/construction/handoff',
      },
      lanes: {
        headed: {
          directDownload: '/storefront/entitlement/path?surface=headed&mode=direct_download',
          tokenizedAccess: '/storefront/entitlement/path?surface=headed&mode=tokenized_access',
          releaseDownload: '/releases/:releaseId/download',
          acceptedSessionInputs: ['buyerUserId', 'guestReceiptCode', 'accessToken', 'bi_session cookie'],
        },
        headless: {
          tokenizedAccess: '/storefront/entitlement/path?surface=headless&mode=tokenized_access',
          releaseDownload: '/releases/:releaseId/download',
          acceptedSessionInputs: ['accessToken', 'Authorization: Bearer <accessToken>'],
        },
      },
      mergeGates: {
        test: 'npm test --silent',
        build: 'npm run build --silent',
        mergeMarkerScan: 'rg "^(<<<<<<<|=======|>>>>>>>)" src || true',
      },
    }));
  });


  app.get('/storefront/playbook/login-to-entitlement', async (_req, reply) => {
    return reply.status(200).send(ok({
      contractVersion: STOREFRONT_CONTRACT_VERSION,
      objective: 'map both auth surfaces to entitlement/download paths',
      headed: {
        login: {
          start: '/auth/qr/start',
          approve: '/auth/qr/approve',
          poll: '/auth/qr/status/:nonce?origin=<origin>',
          statusValues: ['pending', 'approved', 'expired_or_consumed'],
        },
        entitlementModes: {
          direct_download: '/storefront/entitlement/path?surface=headed&mode=direct_download',
          tokenized_access: '/storefront/entitlement/path?surface=headed&mode=tokenized_access',
        },
      },
      headless: {
        login: {
          challenge: '/auth/agent/challenge',
          session: '/auth/agent/session',
          contracts: '/auth/agent/contracts',
          signedChallengeExample: '/auth/agent/signed-challenge/example',
        },
        entitlementModes: {
          tokenized_access: '/storefront/entitlement/path?surface=headless&mode=tokenized_access',
        },
      },
      download: {
        endpoint: '/releases/:releaseId/download',
        directFields: ['buyerUserId', 'guestReceiptCode'],
        tokenized: {
          query: '?accessToken=<accessToken>',
          authorizationHeader: 'Bearer <accessToken>',
          headedCookie: 'bi_session=<accessToken>',
        },
      },
    }));
  });
}
