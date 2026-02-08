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
          flowContracts: '/auth/qr/flow/contracts',
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
          flowContracts: '/auth/agent/flow/contracts',
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
      surfaceContracts: '/storefront/entitlement/surfaces/contracts',
      examples: '/storefront/entitlement/examples',
    }));
  });

  app.get('/storefront/entitlement/surfaces/contracts', async (_req, reply) => {
    return reply.status(200).send(ok({
      version: 'storefront-entitlement-surfaces-v1',
      contractVersion: STOREFRONT_CONTRACT_VERSION,
      objective: 'first-class entitlement path support across headed and headless download/tokenized lanes',
      endpoint: '/releases/:releaseId/download',
      surfaces: {
        headed: {
          directDownload: {
            path: '/storefront/entitlement/path?surface=headed&mode=direct_download',
            fields: ['buyerUserId', 'guestReceiptCode'],
          },
          tokenizedAccess: {
            path: '/storefront/entitlement/path?surface=headed&mode=tokenized_access',
            query: '?accessToken=<accessToken>',
            authorizationHeader: 'Bearer <accessToken>',
            cookie: 'bi_session=<accessToken>',
          },
        },
        headless: {
          tokenizedAccess: {
            path: '/storefront/entitlement/path?surface=headless&mode=tokenized_access',
            query: '?accessToken=<accessToken>',
            authorizationHeader: 'Bearer <accessToken>',
          },
          unsupported: {
            directDownload: '/storefront/entitlement/path?surface=headless&mode=direct_download',
          },
        },
      },
      shared: {
        contracts: '/storefront/download/contracts',
        examples: '/storefront/entitlement/examples',
      },
    }));
  });

  app.get('/storefront/entitlement/path/support-matrix', async (_req, reply) => {
    return reply.status(200).send(ok({
      version: 'storefront-entitlement-path-support-matrix-v1',
      contractVersion: STOREFRONT_CONTRACT_VERSION,
      objective: 'wave-C entitlement support matrix for direct download and tokenized access across headed/headless surfaces',
      execution: {
        priority: 'C',
        burstMode: 'two-wave-hybrid',
        wavePairing: [
          { wave: 'wave-1', priorities: ['A', 'B'] },
          { wave: 'wave-2', priorities: ['C', 'D'] },
        ],
      },
      support: {
        headed: {
          direct_download: {
            supported: true,
            path: '/storefront/entitlement/path?surface=headed&mode=direct_download',
          },
          tokenized_access: {
            supported: true,
            path: '/storefront/entitlement/path?surface=headed&mode=tokenized_access',
          },
        },
        headless: {
          direct_download: {
            supported: false,
            path: '/storefront/entitlement/path?surface=headless&mode=direct_download',
            fallback: '/storefront/entitlement/path?surface=headless&mode=tokenized_access',
          },
          tokenized_access: {
            supported: true,
            path: '/storefront/entitlement/path?surface=headless&mode=tokenized_access',
          },
        },
      },
      downloadContract: '/storefront/download/contracts',
      dependencies: {
        entitlementSurfaces: '/storefront/entitlement/surfaces/contracts',
        scaffoldSurfaces: '/storefront/scaffold/surfaces/contracts',
      },
      mergeGates: {
        test: 'npm test --silent',
        build: 'npm run build --silent',
        mergeMarkerScan: 'rg "^(<<<<<<<|=======|>>>>>>>)" src || true',
      },
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
      execution: {
        burstMode: 'two-wave-hybrid',
        waveOrder: ['A', 'B', 'C', 'D'],
        wavePairing: [
          ['A', 'B'],
          ['C', 'D'],
        ],
        nonOverlap: 'strict',
      },
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

  app.get('/storefront/scaffold/construction/shell-handlers', async (req, reply) => {
    const query = req.query as { surface?: string };
    const surface = query.surface === 'headless' ? 'headless' : 'headed';

    if (surface === 'headless') {
      return reply.status(200).send(ok({
        version: 'storefront-shell-handlers-v1',
        contractVersion: STOREFRONT_CONTRACT_VERSION,
        surface,
        objective: 'headless shell handlers for signed-challenge token handoff and tokenized entitlement execution',
        handlers: {
          authIngress: '/auth/agent/challenge',
          authSession: '/auth/agent/session',
          authHashPreflight: '/auth/agent/verify-hash',
          entitlementPath: '/storefront/entitlement/path?surface=headless&mode=tokenized_access',
          releaseDownload: '/releases/:releaseId/download',
        },
        handoff: {
          tokenType: 'Bearer',
          tokenField: 'accessToken',
          acceptedInputs: ['Authorization: Bearer <accessToken>', '?accessToken=<accessToken>'],
        },
      }));
    }

    return reply.status(200).send(ok({
      version: 'storefront-shell-handlers-v1',
      contractVersion: STOREFRONT_CONTRACT_VERSION,
      surface,
      objective: 'headed shell handlers for lightning QR approval and direct/tokenized entitlement execution',
      handlers: {
        authIngress: '/auth/qr/start',
        authApprove: '/auth/qr/approve',
        authStatusPoll: '/auth/qr/status/:nonce?origin=<origin>',
        entitlementDirect: '/storefront/entitlement/path?surface=headed&mode=direct_download',
        entitlementTokenized: '/storefront/entitlement/path?surface=headed&mode=tokenized_access',
        releaseDownload: '/releases/:releaseId/download',
      },
      handoff: {
        cookieName: 'bi_session',
        authorizationHeader: 'Bearer <accessToken>',
        acceptedInputs: ['bi_session cookie', 'Authorization: Bearer <accessToken>'],
      },
    }));
  });

  app.get('/storefront/scaffold/construction/entitlement-telemetry', async (_req, reply) => {
    return reply.status(200).send(ok({
      version: 'storefront-entitlement-telemetry-v1',
      contractVersion: STOREFRONT_CONTRACT_VERSION,
      objective: 'event schema for entitlement consumption observability across headed and headless storefront lanes',
      events: {
        entitlementPathResolved: {
          fields: ['surface', 'mode', 'supported', 'resolvedAtUnix'],
          source: '/storefront/entitlement/path',
        },
        entitlementConsumed: {
          fields: ['surface', 'accessMode', 'releaseId', 'sessionType', 'consumedAtUnix'],
          source: '/releases/:releaseId/download',
        },
        entitlementRejected: {
          fields: ['surface', 'reason', 'releaseId', 'rejectedAtUnix'],
          source: '/releases/:releaseId/download',
        },
      },
      consumers: {
        headedShell: '/storefront/scaffold/construction/shell-handlers?surface=headed',
        headlessShell: '/storefront/scaffold/construction/shell-handlers?surface=headless',
        authExecutableHandoff: '/auth/storefront/construction/runtime/executable-handoff',
      },
      mergeGates: {
        test: 'npm test --silent',
        build: 'npm run build --silent',
        mergeMarkerScan: 'rg "^(<<<<<<<|=======|>>>>>>>)" src || true',
      },
    }));
  });

  app.get('/storefront/scaffold/construction/entitlement-telemetry/runtime-emit-points', async (_req, reply) => {
    return reply.status(200).send(ok({
      version: 'storefront-entitlement-telemetry-runtime-v1',
      contractVersion: STOREFRONT_CONTRACT_VERSION,
      objective: 'concrete runtime emit points for entitlement resolution/consumption split by headed and headless lanes',
      emitPoints: {
        pathResolution: {
          endpoint: '/storefront/entitlement/path',
          emits: ['entitlement.path_resolved', 'entitlement.path_rejected'],
        },
        downloadConsumption: {
          endpoint: '/releases/:releaseId/download',
          emits: ['entitlement.consumed', 'entitlement.rejected'],
          surfaces: {
            headed: ['buyerUserId', 'guestReceiptCode', 'bi_session cookie', 'Authorization: Bearer <accessToken>'],
            headless: ['Authorization: Bearer <accessToken>', 'accessToken query'],
          },
        },
      },
      authUpstream: {
        executableHandoff: '/auth/storefront/construction/runtime/executable-handoff',
        authEmitPoints: '/auth/storefront/construction/runtime/telemetry-emit-points',
      },
      mergeGates: {
        test: 'npm test --silent',
        build: 'npm run build --silent',
        mergeMarkerScan: 'rg "^(<<<<<<<|=======|>>>>>>>)" src || true',
      },
    }));
  });

  app.get('/storefront/scaffold/construction/entitlement-telemetry/trace-fixtures', async (_req, reply) => {
    return reply.status(200).send(ok({
      version: 'storefront-entitlement-trace-fixtures-v1',
      contractVersion: STOREFRONT_CONTRACT_VERSION,
      objective: 'deterministic cross-lane trace fixtures that bind auth runtime events to entitlement consumption telemetry',
      fixtures: {
        headedHappyPath: {
          steps: [
            'auth.challenge_issued',
            'auth.session_issued',
            'auth.handoff_ready',
            'entitlement.path_resolved',
            'entitlement.consumed',
          ],
          sessionTransport: 'bi_session cookie',
          entitlementMode: 'tokenized_access',
          releaseDownload: '/releases/:releaseId/download?accessToken=<accessToken>',
        },
        headlessHappyPath: {
          steps: [
            'auth.challenge_issued',
            'auth.session_issued',
            'auth.handoff_ready',
            'entitlement.path_resolved',
            'entitlement.consumed',
          ],
          sessionTransport: 'Authorization: Bearer <accessToken>',
          entitlementMode: 'tokenized_access',
          releaseDownload: '/releases/:releaseId/download',
        },
        headedRejectPath: {
          steps: ['auth.session_issued', 'entitlement.path_resolved', 'entitlement.rejected'],
          reason: 'missing_or_invalid_entitlement',
        },
      },
      upstream: {
        authPayloadTemplates: '/auth/storefront/construction/runtime/telemetry/payload-templates',
        authEmitPoints: '/auth/storefront/construction/runtime/telemetry-emit-points',
      },
      mergeGates: {
        test: 'npm test --silent',
        build: 'npm run build --silent',
        mergeMarkerScan: 'rg "^(<<<<<<<|=======|>>>>>>>)" src || true',
      },
    }));
  });

  app.get('/storefront/scaffold/construction/token-transport/contracts', async (_req, reply) => {
    return reply.status(200).send(ok({
      version: 'storefront-token-transport-contracts-v1',
      contractVersion: STOREFRONT_CONTRACT_VERSION,
      authContractVersion: AUTH_CONTRACT_VERSION,
      objective: 'explicit token transport contracts for download and tokenized entitlement across headed + headless lanes',
      surfaces: {
        headed: {
          authSessionSource: '/auth/qr/session/contracts',
          acceptedTokenInputs: ['bi_session cookie', 'Authorization: Bearer <accessToken>', '?accessToken=<accessToken>'],
          entitlementPath: '/storefront/entitlement/path?surface=headed&mode=tokenized_access',
          download: '/releases/:releaseId/download',
        },
        headless: {
          authSessionSource: '/auth/agent/session/contracts',
          acceptedTokenInputs: ['Authorization: Bearer <accessToken>', '?accessToken=<accessToken>'],
          entitlementPath: '/storefront/entitlement/path?surface=headless&mode=tokenized_access',
          download: '/releases/:releaseId/download',
        },
      },
      directDownloadCompatibility: {
        heading: 'headed-only direct download support',
        contract: '/storefront/entitlement/path?surface=headed&mode=direct_download',
        requiredInputs: ['buyerUserId', 'guestReceiptCode'],
      },
      integrationChecks: {
        authRuntimeChecks: '/auth/storefront/construction/runtime/integration-checks',
        traceFixtures: '/storefront/scaffold/construction/entitlement-telemetry/trace-fixtures',
      },
      mergeGates: {
        test: 'npm test --silent',
        build: 'npm run build --silent',
        mergeMarkerScan: 'rg "^(<<<<<<<|=======|>>>>>>>)" src || true',
      },
    }));
  });



  app.get('/storefront/scaffold/construction/release-download/acceptance-fixtures', async (_req, reply) => {
    return reply.status(200).send(ok({
      version: 'storefront-release-download-acceptance-fixtures-v1',
      contractVersion: STOREFRONT_CONTRACT_VERSION,
      authContractVersion: AUTH_CONTRACT_VERSION,
      objective: 'deterministic acceptance fixtures for direct-download + tokenized fallback across headed/headless storefront lanes',
      fixtures: {
        headedDirectDownload: {
          surface: 'headed',
          entitlementPath: '/storefront/entitlement/path?surface=headed&mode=direct_download',
          requiredFields: ['buyerUserId', 'guestReceiptCode'],
          download: '/releases/:releaseId/download?buyerUserId=<buyerUserId>&guestReceiptCode=<guestReceiptCode>',
          expectedStatus: 200,
        },
        headedTokenizedFallback: {
          surface: 'headed',
          fallbackFrom: 'direct_download',
          entitlementPath: '/storefront/entitlement/path?surface=headed&mode=tokenized_access',
          acceptedTokenInputs: ['bi_session cookie', 'Authorization: Bearer <accessToken>', '?accessToken=<accessToken>'],
          download: '/releases/:releaseId/download?accessToken=<accessToken>',
          expectedStatus: 200,
        },
        headlessTokenizedAccess: {
          surface: 'headless',
          entitlementPath: '/storefront/entitlement/path?surface=headless&mode=tokenized_access',
          acceptedTokenInputs: ['Authorization: Bearer <accessToken>', '?accessToken=<accessToken>'],
          download: '/releases/:releaseId/download',
          expectedStatus: 200,
        },
      },
      upstream: {
        authRuntimeAcceptance: '/auth/storefront/construction/runtime/release-download-acceptance',
        authRuntimeChecks: '/auth/storefront/construction/runtime/integration-checks',
        tokenTransportContracts: '/storefront/scaffold/construction/token-transport/contracts',
      },
      mergeGates: {
        test: 'npm test --silent',
        build: 'npm run build --silent',
        mergeMarkerScan: 'rg "^(<<<<<<<|=======|>>>>>>>)" src || true',
      },
    }));
  });

  app.get('/storefront/scaffold/construction/release-download/smoke-fixtures', async (_req, reply) => {
    return reply.status(200).send(ok({
      version: 'storefront-release-download-smoke-fixtures-v1',
      contractVersion: STOREFRONT_CONTRACT_VERSION,
      authContractVersion: AUTH_CONTRACT_VERSION,
      objective: 'executable smoke fixtures for quick CI probes across headed direct/fallback and headless tokenized lanes',
      fixtures: {
        headedDirectDownloadSmoke: {
          authManifest: '/auth/qr/login/manifest',
          entitlementPath: '/storefront/entitlement/path?surface=headed&mode=direct_download',
          releaseDownload: '/releases/:releaseId/download?buyerUserId=<buyerUserId>&guestReceiptCode=<guestReceiptCode>',
          assert: {
            status: 200,
            mode: 'direct_download',
          },
        },
        headedTokenizedFallbackSmoke: {
          authManifest: '/auth/qr/login/manifest',
          entitlementPath: '/storefront/entitlement/path?surface=headed&mode=tokenized_access',
          releaseDownload: '/releases/:releaseId/download?accessToken=<accessToken>',
          acceptedTokenInputs: ['bi_session cookie', 'Authorization: Bearer <accessToken>', '?accessToken=<accessToken>'],
          assert: {
            status: 200,
            mode: 'tokenized_access',
          },
        },
        headlessTokenizedSmoke: {
          authManifest: '/auth/agent/login/manifest',
          entitlementPath: '/storefront/entitlement/path?surface=headless&mode=tokenized_access',
          releaseDownload: '/releases/:releaseId/download',
          acceptedTokenInputs: ['Authorization: Bearer <accessToken>', '?accessToken=<accessToken>'],
          assert: {
            status: 200,
            mode: 'tokenized_access',
          },
        },
      },
      upstream: {
        authSmokeManifest: '/auth/storefront/construction/runtime/release-download-smoke-manifest',
        acceptanceFixtures: '/storefront/scaffold/construction/release-download/acceptance-fixtures',
      },
      mergeGates: {
        test: 'npm test --silent',
        build: 'npm run build --silent',
        mergeMarkerScan: 'rg "^(<<<<<<<|=======|>>>>>>>)" src || true',
      },
    }));
  });

  app.get('/storefront/scaffold/construction/login-entitlement-bridge', async (_req, reply) => {
    return reply.status(200).send(ok({
      version: 'storefront-login-entitlement-bridge-v1',
      contractVersion: STOREFRONT_CONTRACT_VERSION,
      authContractVersion: AUTH_CONTRACT_VERSION,
      objective: 'bridge login construction lanes to entitlement + download surfaces for both human-headed and headless-agent flows',
      headed: {
        authLane: {
          manifest: '/auth/storefront/construction/runtime/login-surface-manifest',
          runtimeBootstrap: '/auth/qr/runtime/bootstrap',
          start: '/auth/qr/start',
          approve: '/auth/qr/approve',
          status: '/auth/qr/status/:nonce?origin=<origin>',
        },
        entitlementLane: {
          directDownload: '/storefront/entitlement/path?surface=headed&mode=direct_download',
          tokenizedAccess: '/storefront/entitlement/path?surface=headed&mode=tokenized_access',
          releaseDownload: '/releases/:releaseId/download',
        },
      },
      headless: {
        authLane: {
          runtimeBootstrap: '/auth/agent/runtime/bootstrap',
          challenge: '/auth/agent/challenge',
          verifyHash: '/auth/agent/verify-hash',
          session: '/auth/agent/session',
          authFlow: 'signed_challenge_v1',
        },
        entitlementLane: {
          tokenizedAccess: '/storefront/entitlement/path?surface=headless&mode=tokenized_access',
          releaseDownload: '/releases/:releaseId/download',
          acceptedTokenInputs: ['Authorization: Bearer <accessToken>', '?accessToken=<accessToken>'],
        },
      },
      integration: {
        smokeFixtures: '/storefront/scaffold/construction/release-download/smoke-fixtures',
        acceptanceFixtures: '/storefront/scaffold/construction/release-download/acceptance-fixtures',
      },
      mergeGates: {
        test: 'npm test --silent',
        build: 'npm run build --silent',
        mergeMarkerScan: 'rg "^(<<<<<<<|=======|>>>>>>>)" src || true',
      },
    }));
  });

  app.get('/storefront/scaffold/construction/runtime/entitlement-access-bridge', async (_req, reply) => {
    return reply.status(200).send(ok({
      version: 'storefront-entitlement-access-bridge-v1',
      contractVersion: STOREFRONT_CONTRACT_VERSION,
      authContractVersion: AUTH_CONTRACT_VERSION,
      objective: 'wave-C bridge that consumes auth entitlement manifest and exposes surfaced headed/headless entitlement scaffolds',
      priorities: {
        C: 'entitlement path support for direct download + tokenized access',
        D: 'parallel storefront scaffold consumption for headed + headless lanes',
      },
      upstream: {
        authEntitlementManifest: '/auth/storefront/construction/runtime/entitlement-access-manifest',
        authLoginManifest: '/auth/storefront/construction/runtime/login-surface-manifest',
      },
      surfaces: {
        headed: {
          scaffold: '/storefront/scaffold?surface=headed',
          directDownload: '/storefront/entitlement/path?surface=headed&mode=direct_download',
          tokenizedAccess: '/storefront/entitlement/path?surface=headed&mode=tokenized_access',
        },
        headless: {
          scaffold: '/storefront/scaffold?surface=headless',
          tokenizedAccess: '/storefront/entitlement/path?surface=headless&mode=tokenized_access',
          directDownloadSupport: {
            supported: false,
            fallbackTo: '/storefront/entitlement/path?surface=headless&mode=tokenized_access',
          },
        },
      },
      dependencies: {
        supportMatrix: '/storefront/entitlement/path/support-matrix',
        loginBridge: '/storefront/scaffold/construction/login-entitlement-bridge',
        compatibilityGuard: '/storefront/scaffold/construction/runtime/compatibility-guard',
      },
      mergeGates: {
        test: 'npm test --silent',
        build: 'npm run build --silent',
        mergeMarkerScan: 'rg "^(<<<<<<<|=======|>>>>>>>)" src || true',
      },
    }));
  });



  app.get('/storefront/scaffold/construction/runtime/entitlement-download-consumption', async (_req, reply) => {
    return reply.status(200).send(ok({
      version: 'storefront-entitlement-download-consumption-v1',
      contractVersion: STOREFRONT_CONTRACT_VERSION,
      authContractVersion: AUTH_CONTRACT_VERSION,
      objective: 'wave-D storefront consumption contract that executes auth-origin entitlement/download contracts across headed + headless lanes',
      priorities: {
        C: 'consume auth entitlement path support for direct + tokenized access',
        D: 'expose parallel storefront scaffold consumption surfaces without overlap into auth issuance handlers',
      },
      upstream: {
        authEntitlementDownloadContracts: '/auth/storefront/construction/runtime/entitlement-download-contracts',
        authEntitlementManifest: '/auth/storefront/construction/runtime/entitlement-access-manifest',
      },
      consumption: {
        headed: {
          scaffold: '/storefront/scaffold?surface=headed',
          directDownload: '/releases/:releaseId/download?buyerUserId=<buyerUserId>&guestReceiptCode=<guestReceiptCode>',
          tokenizedFallback: '/releases/:releaseId/download?accessToken=<accessToken>',
        },
        headless: {
          scaffold: '/storefront/scaffold?surface=headless',
          tokenizedAccess: '/releases/:releaseId/download (Authorization: Bearer <accessToken>)',
          acceptedTokenInputs: ['Authorization: Bearer <accessToken>', '?accessToken=<accessToken>'],
        },
      },
      dependencies: {
        compatibilityGuard: '/storefront/scaffold/construction/runtime/compatibility-guard',
        entitlementBridge: '/storefront/scaffold/construction/runtime/entitlement-access-bridge',
        releaseAcceptanceFixtures: '/storefront/scaffold/construction/release-download/acceptance-fixtures',
      },
      mergeGates: {
        test: 'npm test --silent',
        build: 'npm run build --silent',
        mergeMarkerScan: 'rg "^(<<<<<<<|=======|>>>>>>>)" src || true',
      },
    }));
  });

  app.get('/storefront/scaffold/construction/runtime/release-download-acceptance-contract', async (_req, reply) => {
    return reply.status(200).send(ok({
      version: 'storefront-release-download-acceptance-contract-v1',
      contractVersion: STOREFRONT_CONTRACT_VERSION,
      authContractVersion: AUTH_CONTRACT_VERSION,
      objective: 'wave-D acceptance contract wiring auth session artifacts into headed and headless release download lanes',
      priorities: {
        C: 'bind entitlement path support to concrete download acceptance inputs',
        D: 'ship parallel storefront acceptance surfaces for headed + headless lanes',
      },
      upstream: {
        authSessionArtifacts: '/auth/storefront/construction/runtime/session-artifacts',
        authEntitlementDownloadContracts: '/auth/storefront/construction/runtime/entitlement-download-contracts',
      },
      acceptance: {
        headed: {
          requiredAuthArtifacts: ['bi_session cookie', 'Bearer accessToken'],
          directDownload: '/releases/:releaseId/download?buyerUserId=<buyerUserId>&guestReceiptCode=<guestReceiptCode>',
          tokenizedFallback: '/releases/:releaseId/download?accessToken=<accessToken>',
        },
        headless: {
          requiredAuthArtifacts: ['Bearer accessToken'],
          tokenizedDownload: '/releases/:releaseId/download (Authorization: Bearer <accessToken>)',
          queryTokenFallback: '/releases/:releaseId/download?accessToken=<accessToken>',
        },
      },
      dependencies: {
        entitlementConsumption: '/storefront/scaffold/construction/runtime/entitlement-download-consumption',
        compatibilityGuard: '/storefront/scaffold/construction/runtime/compatibility-guard',
      },
      mergeGates: {
        test: 'npm test --silent',
        build: 'npm run build --silent',
        mergeMarkerScan: 'rg "^(<<<<<<<|=======|>>>>>>>)" src || true',
      },
    }));
  });

  app.get('/storefront/scaffold/construction/runtime/session-contract-consumption', async (_req, reply) => {
    return reply.status(200).send(ok({
      version: 'storefront-session-contract-consumption-v1',
      contractVersion: STOREFRONT_CONTRACT_VERSION,
      authContractVersion: AUTH_CONTRACT_VERSION,
      objective: 'wave-2 contract showing how storefront consumes wave-1 auth session compatibility outputs across headed and headless lanes',
      priorities: {
        C: 'bind auth session contract artifacts into entitlement path routing decisions',
        D: 'keep storefront scaffold/download handlers as first-class consumers without mutating auth issuance lanes',
      },
      upstream: {
        authSessionCompatibility: '/auth/storefront/construction/runtime/session-contract-compatibility',
        authSessionArtifacts: '/auth/storefront/construction/runtime/session-artifacts',
      },
      consumption: {
        headed: {
          reads: ['bi_session cookie', 'accessToken', 'session.userPubkey'],
          usedBy: ['/storefront/scaffold?surface=headed', '/releases/:releaseId/download?accessToken=<accessToken>'],
        },
        headless: {
          reads: ['accessToken', 'challengeHash', 'requestedScopes'],
          usedBy: ['/storefront/scaffold?surface=headless', '/releases/:releaseId/download (Authorization: Bearer <accessToken>)'],
        },
      },
      boundaries: {
        readsFromAuth: ['session compatibility contracts', 'session artifact contracts'],
        writesInStorefront: ['entitlement resolution', 'download acceptance responses'],
      },
      dependencies: {
        entitlementConsumption: '/storefront/scaffold/construction/runtime/entitlement-download-consumption',
        releaseAcceptance: '/storefront/scaffold/construction/runtime/release-download-acceptance-contract',
      },
      mergeGates: {
        test: 'npm test --silent',
        build: 'npm run build --silent',
        mergeMarkerScan: 'rg "^(<<<<<<<|=======|>>>>>>>)" src || true',
      },
    }));
  });

  app.get('/storefront/scaffold/construction/runtime/release-download-acceptance-fixture-consumption', async (_req, reply) => {
    return reply.status(200).send(ok({
      version: 'storefront-release-download-acceptance-fixture-consumption-v1',
      contractVersion: STOREFRONT_CONTRACT_VERSION,
      authContractVersion: AUTH_CONTRACT_VERSION,
      objective: 'wave-2 consumption contract that converts auth-issued session fixture artifacts into headed/headless release download acceptance fixtures',
      priorities: {
        C: 'apply entitlement support matrix to acceptance fixture coverage for direct + tokenized access',
        D: 'scaffold parallel headed/headless acceptance fixture runners without mutating auth fixture emitters',
      },
      upstream: {
        authFixtureHandoff: '/auth/storefront/construction/runtime/release-download-acceptance-fixture-handoff',
        authSessionCompatibility: '/auth/storefront/construction/runtime/session-contract-compatibility',
      },
      fixtureConsumption: {
        headed: {
          consumes: ['bi_session cookie', 'accessToken', 'session.userPubkey'],
          acceptanceFixture: '/storefront/scaffold/construction/release-download/acceptance-fixtures?surface=headed',
          downloadAssertions: ['/releases/:releaseId/download?buyerUserId=<buyerUserId>&guestReceiptCode=<guestReceiptCode>', '/releases/:releaseId/download?accessToken=<accessToken>'],
        },
        headless: {
          consumes: ['accessToken', 'challengeHash', 'requestedScopes'],
          acceptanceFixture: '/storefront/scaffold/construction/release-download/acceptance-fixtures?surface=headless',
          downloadAssertions: ['/releases/:releaseId/download (Authorization: Bearer <accessToken>)', '/releases/:releaseId/download?accessToken=<accessToken>'],
        },
      },
      boundaries: {
        readsFromAuth: ['release-download acceptance fixture handoff', 'session compatibility contracts'],
        writesInStorefront: ['fixture runner scenarios', 'download acceptance assertions'],
      },
      dependencies: {
        releaseAcceptanceContract: '/storefront/scaffold/construction/runtime/release-download-acceptance-contract',
        sessionConsumption: '/storefront/scaffold/construction/runtime/session-contract-consumption',
      },
      mergeGates: {
        test: 'npm test --silent',
        build: 'npm run build --silent',
        mergeMarkerScan: 'rg "^(<<<<<<<|=======|>>>>>>>)" src || true',
      },
    }));
  });

  app.get('/storefront/scaffold/construction/execution-checklist', async (_req, reply) => {
    return reply.status(200).send(ok({
      version: 'storefront-execution-checklist-v1',
      contractVersion: STOREFRONT_CONTRACT_VERSION,
      authContractVersion: AUTH_CONTRACT_VERSION,
      objective: 'single runnable execution checklist for headed + headless login-to-download lanes with strict non-overlap boundaries',
      lanes: {
        headed: {
          boundary: 'auth handlers issue sessions; storefront handlers resolve entitlement/download',
          checklist: [
            'POST /auth/qr/start -> capture challenge nonce + lightning uri',
            'POST /auth/qr/approve -> assert session + bi_session cookie',
            'GET /auth/qr/status/:nonce?origin=<origin> -> assert approved + accessToken',
            'GET /storefront/entitlement/path?surface=headed&mode=direct_download -> assert supported=true',
            'GET /storefront/entitlement/path?surface=headed&mode=tokenized_access -> assert supported=true',
            'GET /releases/:releaseId/download?accessToken=<accessToken> -> assert 200',
          ],
        },
        headless: {
          boundary: 'agent auth handlers issue Bearer token; storefront handlers resolve tokenized entitlement/download',
          checklist: [
            'POST /auth/agent/challenge -> capture challenge + hash preview',
            'POST /auth/agent/verify-hash -> assert matches=true',
            'POST /auth/agent/session -> assert accessToken',
            'GET /storefront/entitlement/path?surface=headless&mode=tokenized_access -> assert supported=true',
            'GET /releases/:releaseId/download (Authorization: Bearer <accessToken>) -> assert 200',
          ],
        },
      },
      dependencies: {
        authExecutionLanes: '/auth/storefront/construction/runtime/execution-lanes',
        authSmokeManifest: '/auth/storefront/construction/runtime/release-download-smoke-manifest',
        releaseSmokeFixtures: '/storefront/scaffold/construction/release-download/smoke-fixtures',
      },
      mergeGates: {
        test: 'npm test --silent',
        build: 'npm run build --silent',
        mergeMarkerScan: 'rg "^(<<<<<<<|=======|>>>>>>>)" src || true',
      },
    }));
  });

  app.get('/storefront/scaffold/construction/execution-receipts', async (_req, reply) => {
    return reply.status(200).send(ok({
      version: 'storefront-execution-receipts-v1',
      contractVersion: STOREFRONT_CONTRACT_VERSION,
      authContractVersion: AUTH_CONTRACT_VERSION,
      objective: 'storefront-side wave receipts for one strict 2-wave hybrid auth/store construction burst',
      execution: {
        burstMode: 'two-wave-hybrid',
        wavePairing: [
          { wave: 'wave-1', priorities: ['A', 'B'] },
          { wave: 'wave-2', priorities: ['C', 'D'] },
        ],
        nonOverlap: 'strict',
      },
      receipts: {
        wave1AuthIngress: {
          headed: ['/auth/qr/start', '/auth/qr/approve', '/auth/qr/status/:nonce?origin=<origin>'],
          headless: ['/auth/agent/challenge', '/auth/agent/verify-hash', '/auth/agent/session'],
        },
        wave2EntitlementAndScaffold: {
          headedDirect: '/storefront/entitlement/path?surface=headed&mode=direct_download',
          headedTokenized: '/storefront/entitlement/path?surface=headed&mode=tokenized_access',
          headlessTokenized: '/storefront/entitlement/path?surface=headless&mode=tokenized_access',
          download: '/releases/:releaseId/download',
          scaffoldHeaded: '/storefront/scaffold?surface=headed',
          scaffoldHeadless: '/storefront/scaffold?surface=headless',
          scaffoldContracts: '/storefront/scaffold/surfaces/contracts',
        },
      },
      dependencies: {
        authExecutionReceipts: '/auth/storefront/construction/runtime/execution-receipts',
        shipReadiness: '/storefront/scaffold/construction/ship-readiness',
      },
      mergeGates: {
        test: 'npm test --silent',
        build: 'npm run build --silent',
        mergeMarkerScan: 'rg "^(<<<<<<<|=======|>>>>>>>)" src || true',
      },
    }));
  });

  app.get('/storefront/scaffold/construction/fixture-execution-manifest', async (_req, reply) => {
    return reply.status(200).send(ok({
      version: 'storefront-fixture-execution-manifest-v1',
      contractVersion: STOREFRONT_CONTRACT_VERSION,
      authContractVersion: AUTH_CONTRACT_VERSION,
      objective: 'consume auth-produced session artifacts and execute C/D entitlement + scaffold lanes without overlap back into auth issuance handlers',
      wave: {
        id: 'wave-2',
        priorities: ['C', 'D'],
        nonOverlapBoundary: 'storefront reads auth artifacts; auth issuance remains immutable for this wave',
      },
      prerequisites: {
        authFixtureExecution: '/auth/storefront/construction/runtime/fixture-execution-manifest',
        authExecutionReceipts: '/auth/storefront/construction/runtime/execution-receipts',
      },
      headedLaneConsumption: {
        entitlementPath: '/storefront/entitlement/path?surface=headed&mode=tokenized_access',
        releaseDownload: '/releases/:releaseId/download?accessToken=<accessToken>',
        expectedArtifactInputs: ['accessToken'],
      },
      headlessLaneConsumption: {
        entitlementPath: '/storefront/entitlement/path?surface=headless&mode=tokenized_access',
        releaseDownload: '/releases/:releaseId/download',
        acceptedTokenInputs: ['Authorization: Bearer <accessToken>', '?accessToken=<accessToken>'],
      },
      scaffoldSurfaces: {
        headed: '/storefront/scaffold?surface=headed',
        headless: '/storefront/scaffold?surface=headless',
        parallelContracts: '/storefront/scaffold/surfaces/contracts',
      },
      dependencies: {
        executionChecklist: '/storefront/scaffold/construction/execution-checklist',
        shipReadiness: '/storefront/scaffold/construction/ship-readiness',
      },
      mergeGates: {
        test: 'npm test --silent',
        build: 'npm run build --silent',
        mergeMarkerScan: 'rg "^(<<<<<<<|=======|>>>>>>>)" src || true',
      },
    }));
  });

  app.get('/storefront/scaffold/construction/fixture-execution-runbook', async (_req, reply) => {
    return reply.status(200).send(ok({
      version: 'storefront-fixture-execution-runbook-v1',
      contractVersion: STOREFRONT_CONTRACT_VERSION,
      authContractVersion: AUTH_CONTRACT_VERSION,
      objective: 'operator-ready wave-2 runbook that consumes auth fixture outputs and executes entitlement + scaffold lanes in strict non-overlap',
      prerequisites: {
        authRunbook: '/auth/storefront/construction/runtime/fixture-execution-runbook',
        fixtureManifest: '/storefront/scaffold/construction/fixture-execution-manifest',
      },
      wave2Sequence: [
        {
          lane: 'C',
          title: 'entitlement-path-consumption',
          execute: [
            'GET /storefront/entitlement/path?surface=headed&mode=tokenized_access',
            'GET /storefront/entitlement/path?surface=headless&mode=tokenized_access',
            'GET /releases/:releaseId/download?accessToken=<accessToken>',
          ],
        },
        {
          lane: 'D',
          title: 'storefront-scaffold-contract-surfaces',
          execute: [
            'GET /storefront/scaffold?surface=headed',
            'GET /storefront/scaffold?surface=headless',
            'GET /storefront/scaffold/surfaces/contracts',
          ],
        },
      ],
      outputs: {
        readiness: '/storefront/scaffold/construction/ship-readiness',
        compatibilityGuard: '/storefront/scaffold/construction/runtime/compatibility-guard',
      },
      mergeGates: {
        test: 'npm test --silent',
        build: 'npm run build --silent',
        mergeMarkerScan: 'rg "^(<<<<<<<|=======|>>>>>>>)" src || true',
      },
    }));
  });


  app.get('/storefront/scaffold/construction/fixture-payload-skeletons', async (_req, reply) => {
    return reply.status(200).send(ok({
      version: 'storefront-fixture-payload-skeletons-v1',
      contractVersion: STOREFRONT_CONTRACT_VERSION,
      authContractVersion: AUTH_CONTRACT_VERSION,
      objective: 'storefront-facing payload skeletons that pair with auth fixture templates for headed + headless CI lanes',
      payloadSkeletons: {
        headedEntitlementProbe: {
          path: 'headed-entitlement-probe.json',
          shape: {
            surface: 'headed',
            mode: 'tokenized_access',
            accessToken: '<from /auth/qr/approve or /auth/qr/status approved payload>',
          },
          requests: [
            "curl -sS '$ORIGIN/storefront/entitlement/path?surface=headed&mode=tokenized_access'",
            "curl -sS -H 'Authorization: Bearer $ACCESS_TOKEN' '$ORIGIN/releases/$RELEASE_ID/download' -o /tmp/headed-storefront.bin",
          ],
        },
        headlessEntitlementProbe: {
          path: 'headless-entitlement-probe.json',
          shape: {
            surface: 'headless',
            mode: 'tokenized_access',
            accessToken: '<from /auth/agent/session accessToken>',
          },
          requests: [
            "curl -sS '$ORIGIN/storefront/entitlement/path?surface=headless&mode=tokenized_access'",
            "curl -sS -H 'Authorization: Bearer $ACCESS_TOKEN' '$ORIGIN/releases/$RELEASE_ID/download' -o /tmp/headless-storefront.bin",
          ],
        },
      },
      dependencies: {
        authFixturePayloads: '/auth/storefront/construction/runtime/fixture-payload-skeletons',
        authCiTemplates: '/auth/storefront/construction/runtime/ci-command-templates',
        storefrontCiTemplates: '/storefront/scaffold/construction/ci-command-templates',
      },
      mergeGates: {
        test: 'npm test --silent',
        build: 'npm run build --silent',
        mergeMarkerScan: 'rg "^(<<<<<<<|=======|>>>>>>>)" src || true',
      },
    }));
  });

  app.get('/storefront/scaffold/construction/fixture-bundle-manifest', async (_req, reply) => {
    return reply.status(200).send(ok({
      version: 'storefront-fixture-bundle-manifest-v1',
      contractVersion: STOREFRONT_CONTRACT_VERSION,
      authContractVersion: AUTH_CONTRACT_VERSION,
      objective: 'single-file storefront fixture bundle manifest for headed + headless entitlement probes',
      bundle: {
        file: 'storefront-runtime-fixtures.bundle.json',
        bundleVersion: 'storefront-runtime-fixtures.bundle.v2',
        bundleDigest: 'sha256:storefront-runtime-fixtures-bundle-v2-contract-digest',
        generatedFrom: '/storefront/scaffold/construction/fixture-payload-skeletons',
        payloads: [
          {
            id: 'headed-entitlement-probe',
            path: 'headed-entitlement-probe.json',
            purpose: 'probe headed tokenized entitlement + download contract',
          },
          {
            id: 'headless-entitlement-probe',
            path: 'headless-entitlement-probe.json',
            purpose: 'probe headless tokenized entitlement + download contract',
          },
        ],
      },
      execution: {
        fetchOnceEndpoint: '/storefront/scaffold/construction/fixture-bundle-manifest',
        companionAuthBundle: '/auth/storefront/construction/runtime/fixture-bundle-manifest',
        compatibilityMatrix: '/storefront/scaffold/construction/fixture-bundle-compatibility',
        executableExamples: ['/storefront/scaffold/construction/ci-command-templates'],
      },
      dependencies: {
        fixturePayloadSkeletons: '/storefront/scaffold/construction/fixture-payload-skeletons',
        authFixtureBundle: '/auth/storefront/construction/runtime/fixture-bundle-manifest',
        storefrontCiTemplates: '/storefront/scaffold/construction/ci-command-templates',
      },
      mergeGates: {
        test: 'npm test --silent',
        build: 'npm run build --silent',
        mergeMarkerScan: 'rg "^(<<<<<<<|=======|>>>>>>>)" src || true',
      },
    }));
  });

  app.get('/storefront/scaffold/construction/runtime/fixture-bundle/materialize', async (_req, reply) => {
    return reply.status(200).send(ok({
      version: 'storefront-fixture-bundle-materialize-v1',
      contractVersion: STOREFRONT_CONTRACT_VERSION,
      authContractVersion: AUTH_CONTRACT_VERSION,
      objective: 'materialize storefront-side runnable fixture bundle that consumes fresh auth fixture materialization for headed/headless lanes',
      consumeFrom: '/auth/storefront/construction/runtime/fixture-bundle/materialize',
      lanes: {
        headed: {
          entitlementPathProbe: '/storefront/entitlement/path?surface=headed&mode=tokenized_access',
          downloadProbeTemplate: "/releases/:releaseId/download?accessToken=<headed.accessToken>",
          acceptedTokenInputs: ['bi_session cookie', 'Authorization: Bearer <accessToken>', '?accessToken=<accessToken>'],
        },
        headless: {
          entitlementPathProbe: '/storefront/entitlement/path?surface=headless&mode=tokenized_access',
          downloadProbeTemplate: '/releases/:releaseId/download (Authorization: Bearer <headless.accessToken>)',
          acceptedTokenInputs: ['Authorization: Bearer <accessToken>', '?accessToken=<accessToken>'],
        },
      },
      commandTemplates: {
        headed: [
          "curl -sS '$ORIGIN/storefront/entitlement/path?surface=headed&mode=tokenized_access'",
          "curl -sS '$ORIGIN/releases/$RELEASE_ID/download?accessToken=$HEADED_ACCESS_TOKEN' -o /tmp/headed-download.bin",
        ],
        headless: [
          "curl -sS '$ORIGIN/storefront/entitlement/path?surface=headless&mode=tokenized_access'",
          "curl -sS -H 'Authorization: Bearer $HEADLESS_ACCESS_TOKEN' '$ORIGIN/releases/$RELEASE_ID/download' -o /tmp/headless-download.bin",
        ],
      },
      dependencies: {
        authMaterialize: '/auth/storefront/construction/runtime/fixture-bundle/materialize',
        storefrontBundleManifest: '/storefront/scaffold/construction/fixture-bundle-manifest',
      },
    }));
  });

  app.get('/storefront/scaffold/construction/fixture-bundle-compatibility', async (_req, reply) => {
    return reply.status(200).send(ok({
      version: 'storefront-fixture-bundle-compatibility-v1',
      contractVersion: STOREFRONT_CONTRACT_VERSION,
      authContractVersion: AUTH_CONTRACT_VERSION,
      objective: 'storefront-side compatibility mirror for auth/storefront fixture bundles used by CI lanes',
      bundles: {
        storefront: {
          manifest: '/storefront/scaffold/construction/fixture-bundle-manifest',
          bundleVersion: 'storefront-runtime-fixtures.bundle.v2',
          bundleDigest: 'sha256:storefront-runtime-fixtures-bundle-v2-contract-digest',
        },
        auth: {
          manifest: '/auth/storefront/construction/runtime/fixture-bundle-manifest',
          bundleVersion: 'auth-runtime-fixtures.bundle.v2',
          bundleDigest: 'sha256:auth-runtime-fixtures-bundle-v2-contract-digest',
        },
      },
      compatibility: {
        acceptedPairs: [
          {
            storefrontBundleVersion: 'storefront-runtime-fixtures.bundle.v2',
            authBundleVersion: 'auth-runtime-fixtures.bundle.v2',
            status: 'compatible',
          },
        ],
        unknownPairPolicy: 'reject_ci_run',
      },
      dependencies: {
        authCompatibilitySource: '/auth/storefront/construction/runtime/fixture-bundle-compatibility',
        storefrontBundleManifest: '/storefront/scaffold/construction/fixture-bundle-manifest',
      },
      mergeGates: {
        test: 'npm test --silent',
        build: 'npm run build --silent',
        mergeMarkerScan: 'rg "^(<<<<<<<|=======|>>>>>>>)" src || true',
      },
    }));
  });

  app.get('/storefront/scaffold/construction/ci-command-templates', async (_req, reply) => {
    return reply.status(200).send(ok({
      version: 'storefront-ci-command-templates-v1',
      contractVersion: STOREFRONT_CONTRACT_VERSION,
      authContractVersion: AUTH_CONTRACT_VERSION,
      objective: 'copy-paste CI command templates for headed/headless entitlement + download assertions after auth handoff',
      commands: {
        headed: [
          "curl -sS '$ORIGIN/storefront/entitlement/path?surface=headed&mode=direct_download'",
          "curl -sS '$ORIGIN/storefront/entitlement/path?surface=headed&mode=tokenized_access'",
          "curl -sS -H 'Authorization: Bearer $ACCESS_TOKEN' '$ORIGIN/releases/$RELEASE_ID/download' -o /tmp/headed-storefront.bin",
        ],
        headless: [
          "curl -sS '$ORIGIN/storefront/entitlement/path?surface=headless&mode=tokenized_access'",
          "curl -sS -H 'Authorization: Bearer $ACCESS_TOKEN' '$ORIGIN/releases/$RELEASE_ID/download' -o /tmp/headless-storefront.bin",
        ],
      },
      dependencies: {
        executionChecklist: '/storefront/scaffold/construction/execution-checklist',
        authCiTemplates: '/auth/storefront/construction/runtime/ci-command-templates',
        smokeFixtures: '/storefront/scaffold/construction/release-download/smoke-fixtures',
      },
      mergeGates: {
        test: 'npm test --silent',
        build: 'npm run build --silent',
        mergeMarkerScan: 'rg "^(<<<<<<<|=======|>>>>>>>)" src || true',
      },
    }));
  });

  app.get('/storefront/scaffold/construction/surface-readiness-matrix', async (_req, reply) => {
    return reply.status(200).send(ok({
      version: 'storefront-surface-readiness-matrix-v1',
      contractVersion: STOREFRONT_CONTRACT_VERSION,
      authContractVersion: AUTH_CONTRACT_VERSION,
      objective: 'single readiness matrix for headed and headless storefront construction surfaces after auth handoff',
      execution: {
        burstMode: 'two-wave-hybrid',
        wavePairing: [
          ['A', 'B'],
          ['C', 'D'],
        ],
        nonOverlap: 'strict',
      },
      surfaces: {
        headed: {
          auth: {
            start: '/auth/qr/start',
            approve: '/auth/qr/approve',
            status: '/auth/qr/status/:nonce?origin=<origin>',
            manifest: '/auth/qr/login/manifest',
          },
          entitlement: {
            directDownload: '/storefront/entitlement/path?surface=headed&mode=direct_download',
            tokenizedAccess: '/storefront/entitlement/path?surface=headed&mode=tokenized_access',
          },
          download: '/releases/:releaseId/download',
        },
        headless: {
          auth: {
            challenge: '/auth/agent/challenge',
            verifyHash: '/auth/agent/verify-hash',
            session: '/auth/agent/session',
            manifest: '/auth/agent/login/manifest',
          },
          entitlement: {
            tokenizedAccess: '/storefront/entitlement/path?surface=headless&mode=tokenized_access',
          },
          download: '/releases/:releaseId/download',
        },
      },
      mergeGates: {
        tests: 'npm test --silent',
        build: 'npm run build --silent',
        mergeMarkers: "rg -n '^(<<<<<<<|=======|>>>>>>>)' ../../..",
      },
      dependencies: {
        authPriorityCheckpoint: '/auth/storefront/construction/runtime/priority-checkpoint',
        authRuntime: '/auth/storefront/construction/runtime',
        storefrontExecutionChecklist: '/storefront/scaffold/construction/execution-checklist',
      },
    }));
  });

  app.get('/storefront/scaffold/construction/ship-readiness', async (_req, reply) => {
    return reply.status(200).send(ok({
      version: 'storefront-ship-readiness-v1',
      contractVersion: STOREFRONT_CONTRACT_VERSION,
      authContractVersion: AUTH_CONTRACT_VERSION,
      objective: 'single storefront-side readiness gate that mirrors auth A/B/C/D construction priorities for ship decisions',
      execution: {
        burstMode: 'two-wave-hybrid',
        wavePairing: [
          ['A', 'B'],
          ['C', 'D'],
        ],
        nonOverlap: 'strict',
      },
      priorities: {
        A: {
          title: 'human lightning login implementation',
          ready: true,
          surfacedBy: ['/auth/qr/login/manifest', '/auth/qr/session/contracts'],
        },
        B: {
          title: 'headless signed-challenge auth for agents',
          ready: true,
          surfacedBy: ['/auth/agent/login/manifest', '/auth/agent/session/contracts'],
        },
        C: {
          title: 'entitlement path support for download + tokenized access',
          ready: true,
          surfacedBy: ['/storefront/download/contracts', '/storefront/entitlement/surfaces/contracts'],
        },
        D: {
          title: 'parallel storefront scaffolding in headed + headless lanes',
          ready: true,
          surfacedBy: ['/storefront/scaffold/parallel-lanes/manifest', '/storefront/scaffold/surfaces/contracts'],
        },
      },
      mergeGates: {
        tests: 'npm test --silent',
        build: 'npm run build --silent',
        mergeMarkers: "rg -n '^(<<<<<<<|=======|>>>>>>>)' ../../..",
      },
      dependencies: {
        authShipReadiness: '/auth/storefront/construction/runtime/ship-readiness',
        surfaceReadinessMatrix: '/storefront/scaffold/construction/surface-readiness-matrix',
        handoff: '/storefront/scaffold/construction/handoff',
      },
    }));
  });

  app.get('/storefront/scaffold/construction/runtime/compatibility-guard', async (_req, reply) => {
    const checkpoints = {
      waveCD: {
        ids: ['C', 'D'],
        checks: [
          '/storefront/entitlement/path/support-matrix',
          '/storefront/scaffold/surfaces/contracts',
          '/storefront/scaffold/parallel-lanes/manifest',
        ],
      },
    };

    const status = {
      waveCD: {
        ids: checkpoints.waveCD.ids,
        ready: checkpoints.waveCD.checks.length > 0,
        blockingReasons: [] as string[],
      },
    };

    return reply.status(200).send(ok({
      version: 'storefront-runtime-compatibility-guard-v1',
      contractVersion: STOREFRONT_CONTRACT_VERSION,
      authContractVersion: AUTH_CONTRACT_VERSION,
      objective: 'compact GO/NO_GO guard for wave-C/D entitlement + scaffold construction surfaces',
      execution: {
        burstMode: 'two-wave-hybrid',
        wavePairing: [
          { wave: 'wave-1', priorities: ['A', 'B'] },
          { wave: 'wave-2', priorities: ['C', 'D'] },
        ],
      },
      checkpoints,
      checkpointStatus: status,
      decision: status.waveCD.ready ? 'GO' : 'NO_GO',
      dependencies: {
        authGuard: '/auth/storefront/construction/runtime/compatibility-guard',
        shipReadiness: '/storefront/scaffold/construction/ship-readiness',
      },
      mergeGates: {
        test: 'npm test --silent',
        build: 'npm run build --silent',
        mergeMarkerScan: 'rg "^(<<<<<<<|=======|>>>>>>>)" src || true',
      },
    }));
  });


  app.get('/storefront/scaffold/construction/runtime/lane-consumption-ledger', async (_req, reply) => {
    return reply.status(200).send(ok({
      version: 'storefront-lane-consumption-ledger-v1',
      contractVersion: STOREFRONT_CONTRACT_VERSION,
      authContractVersion: AUTH_CONTRACT_VERSION,
      objective: 'wave-2 consumption ledger showing how storefront consumes auth-issued session artifacts without ownership overlap',
      execution: {
        burstMode: 'two-wave-hybrid',
        activeWave: 'wave-2',
        priorities: ['C', 'D'],
        upstreamWave: {
          wave: 'wave-1',
          priorities: ['A', 'B'],
          source: '/auth/storefront/construction/runtime/lane-ownership-ledger',
        },
      },
      consumption: {
        C: {
          title: 'entitlement path support for download + tokenized access',
          headed: {
            direct: '/storefront/entitlement/path?surface=headed&mode=direct_download',
            tokenized: '/storefront/entitlement/path?surface=headed&mode=tokenized_access',
          },
          headless: {
            tokenized: '/storefront/entitlement/path?surface=headless&mode=tokenized_access',
          },
          authArtifactsConsumed: ['/auth/qr/session/contracts', '/auth/agent/session/contracts'],
        },
        D: {
          title: 'parallel storefront scaffolding surfaces',
          headedScaffold: '/storefront/scaffold?surface=headed',
          headlessScaffold: '/storefront/scaffold?surface=headless',
          contracts: ['/storefront/scaffold/parallel-lanes/manifest', '/storefront/scaffold/surfaces/contracts'],
          authArtifactsConsumed: ['/auth/qr/login/manifest', '/auth/agent/login/manifest'],
        },
      },
      boundaries: {
        readsFromAuth: ['login manifests', 'session contracts'],
        writesInStorefront: ['entitlement routes', 'scaffold surfaces', 'download transport contracts'],
      },
      mergeGates: {
        tests: 'npm test --silent',
        build: 'npm run build --silent',
        mergeMarkerScan: "rg '^(<<<<<<<|=======|>>>>>>>)' src",
      },
    }));
  });

  app.get('/storefront/scaffold/construction/runtime/wave-deliverables-consumption', async (_req, reply) => {
    return reply.status(200).send(ok({
      version: 'storefront-wave-deliverables-consumption-v1',
      contractVersion: STOREFRONT_CONTRACT_VERSION,
      authContractVersion: AUTH_CONTRACT_VERSION,
      objective: 'wave-2 storefront consumption map for auth wave-1 deliverables with strict non-overlap boundaries',
      execution: {
        activeWave: 'wave-2',
        priorities: ['C', 'D'],
        upstreamWave: {
          wave: 'wave-1',
          priorities: ['A', 'B'],
          source: '/auth/storefront/construction/runtime/wave-deliverables-ledger',
        },
        nonOverlap: 'strict',
      },
      consumption: {
        C: {
          title: 'entitlement path support for both download and tokenized access',
          headed: {
            directDownload: '/storefront/entitlement/path?surface=headed&mode=direct_download',
            tokenizedAccess: '/storefront/entitlement/path?surface=headed&mode=tokenized_access',
          },
          headless: {
            tokenizedAccess: '/storefront/entitlement/path?surface=headless&mode=tokenized_access',
          },
          authInputs: ['/auth/qr/session/contracts', '/auth/agent/session/contracts'],
        },
        D: {
          title: 'parallel storefront scaffolding contract surfaces',
          surfaces: ['/storefront/scaffold?surface=headed', '/storefront/scaffold?surface=headless'],
          contracts: ['/storefront/scaffold/parallel-lanes/manifest', '/storefront/scaffold/surfaces/contracts'],
          authInputs: ['/auth/qr/login/manifest', '/auth/agent/login/manifest'],
        },
      },
      boundaries: {
        readsFromAuth: ['session contracts', 'login manifests'],
        writesInStorefront: ['entitlement path responses', 'scaffold contract surfaces'],
      },
      mergeGates: {
        tests: 'npm test --silent',
        build: 'npm run build --silent',
        mergeMarkerScan: "rg '^(<<<<<<<|=======|>>>>>>>)' src",
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
