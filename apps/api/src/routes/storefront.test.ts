import fastify from 'fastify';
import { describe, expect, it } from 'vitest';
import { registerStorefrontRoutes } from './storefront.js';

describe('storefront contract routes', () => {
  it('GET /storefront/lanes returns hybrid lane map for headed + headless execution', async () => {
    const app = fastify({ logger: false });
    await registerStorefrontRoutes(app);

    const res = await app.inject({
      method: 'GET',
      url: '/storefront/lanes',
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.ok).toBe(true);
    expect(body.executionModel).toBe('hybrid');
    expect(body.strictNonOverlap).toBe(true);
    expect(body.lanes.headed.auth.approve).toBe('/auth/qr/approve');
    expect(body.lanes.headed.entitlement.tokenizedAccess.cookie).toContain('bi_session');
    expect(body.lanes.headless.auth.authFlow).toBe('signed_challenge_v1');
    expect(body.lanes.headless.auth.contracts).toBe('/auth/agent/contracts');
    expect(body.lanes.headless.entitlement.tokenizedAccess.authorizationHeader).toBe('Bearer <accessToken>');

    await app.close();
  });

  it('GET /storefront/contracts returns headed + headless contract surfaces', async () => {
    const app = fastify({ logger: false });
    await registerStorefrontRoutes(app);

    const res = await app.inject({
      method: 'GET',
      url: '/storefront/contracts',
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.ok).toBe(true);
    expect(body.contractVersion).toBe('storefront-contract-v3');
    expect(body.headed.login.cookieName).toBe('bi_session');
    expect(body.headed.login.qrStart).toBe('/auth/qr/start');
    expect(body.headed.login.qrApprove).toBe('/auth/qr/approve');
    expect(body.headed.login.qrStatusValues).toContain('approved');
    expect(body.headless.auth.challenge).toBe('/auth/agent/challenge');
    expect(body.headless.auth.session).toBe('/auth/agent/session');
    expect(body.headless.auth.contracts).toBe('/auth/agent/contracts');
    expect(body.headless.auth.tokenField).toBe('accessToken');
    expect(body.headless.auth.signatureEncoding).toBe('0x-hex-64-byte');
    expect(body.headless.auth.challengeHash.algorithm).toBe('sha256');
    expect(body.headless.auth.optionalChallengeHashField).toBe('challengeHash');
    expect(body.headed.download.entitlementInputs).toContain('accessToken');
    expect(body.headed.download.authorizationHeader).toBe('Bearer <accessToken>');
    expect(body.headed.download.cookieToken).toBe('bi_session');
    expect(body.headless.download.entitlementInputs).toContain('accessToken');
    expect(body.headless.download.tokenizedEndpoint).toContain('accessToken=<accessToken>');
    expect(body.headed.storefront.scaffold).toContain('surface=headed');
    expect(body.headless.storefront.scaffold).toContain('surface=headless');
    expect(body.headed.storefront.lanes.entitlement).toContain('/releases/:releaseId/download');
    expect(body.headless.storefront.lanes.tokenized).toContain('Bearer <accessToken>');

    await app.close();
  });

  it('GET /storefront/entitlements returns direct + tokenized contracts for headed/headless lanes', async () => {
    const app = fastify({ logger: false });
    await registerStorefrontRoutes(app);

    const res = await app.inject({
      method: 'GET',
      url: '/storefront/entitlements',
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.ok).toBe(true);
    expect(body.contracts.download.endpoint).toBe('/releases/:releaseId/download');
    expect(body.contracts.download.modes.direct).toContain('buyerUserId');
    expect(body.contracts.download.modes.tokenized.authorizationHeader).toBe('Bearer <accessToken>');
    expect(body.surfaces.headed.supports).toContain('direct_download');
    expect(body.surfaces.headless.supports).toContain('tokenized_access');

    const headedTokenized = await app.inject({
      method: 'GET',
      url: '/storefront/entitlement/path?surface=headed&mode=tokenized_access',
    });
    expect(headedTokenized.statusCode).toBe(200);
    expect(headedTokenized.json().supported).toBe(true);
    expect(headedTokenized.json().requirements.authorizationHeader).toBe('Bearer <accessToken>');

    const headlessDirect = await app.inject({
      method: 'GET',
      url: '/storefront/entitlement/path?surface=headless&mode=direct_download',
    });
    expect(headlessDirect.statusCode).toBe(409);
    expect(headlessDirect.json().supported).toBe(false);

    await app.close();
  });

  it('GET /storefront/entitlement/examples returns concrete direct + tokenized request examples', async () => {
    const app = fastify({ logger: false });
    await registerStorefrontRoutes(app);

    const res = await app.inject({
      method: 'GET',
      url: '/storefront/entitlement/examples',
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.ok).toBe(true);
    expect(body.headed.directDownload.buyerUserId).toContain('buyerUserId');
    expect(body.headed.tokenizedAccess.cookie).toContain('bi_session');
    expect(body.headless.tokenizedAccess.authorizationHeader).toContain('Bearer <accessToken>');

    await app.close();
  });

  it('GET /storefront/scaffold returns headed and headless lane scaffolds', async () => {
    const app = fastify({ logger: false });
    await registerStorefrontRoutes(app);

    const headedRes = await app.inject({ method: 'GET', url: '/storefront/scaffold' });
    expect(headedRes.statusCode).toBe(200);
    const headed = headedRes.json();
    expect(headed.surface).toBe('headed');
    expect(headed.authContract.qrApprove).toBe('/auth/qr/approve');
    expect(headed.entitlementContract.supports).toContain('direct_download');
    expect(headed.entitlementContract.supports).toContain('tokenized_access');
    expect(headed.storefrontLane.laneScaffold.entitlement).toContain('/storefront/entitlement/path?surface=headed');

    const headlessRes = await app.inject({
      method: 'GET',
      url: '/storefront/scaffold?surface=headless',
    });
    expect(headlessRes.statusCode).toBe(200);
    const headless = headlessRes.json();
    expect(headless.surface).toBe('headless');
    expect(headless.authContract.challenge).toBe('/auth/agent/challenge');
    expect(headless.authContract.contracts).toBe('/auth/agent/contracts');
    expect(headless.entitlementContract.supports).toContain('tokenized_access');
    expect(headless.storefrontLane.laneScaffold.entitlement).toContain('/storefront/entitlement/path?surface=headless');

    await app.close();
  });



  it('GET /storefront/download/contracts returns direct + tokenized entitlement download contract', async () => {
    const app = fastify({ logger: false });
    await registerStorefrontRoutes(app);

    const res = await app.inject({ method: 'GET', url: '/storefront/download/contracts' });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.ok).toBe(true);
    expect(body.endpoint).toBe('/releases/:releaseId/download');
    expect(body.modes.direct_download.supportedSurfaces).toContain('headed');
    expect(body.modes.tokenized_access.supportedSurfaces).toContain('headless');
    expect(body.modes.tokenized_access.authorizationHeader).toBe('Bearer <accessToken>');

    await app.close();
  });

  it('GET /storefront/scaffold/contracts returns first-class headed + headless scaffold contract surfaces', async () => {
    const app = fastify({ logger: false });
    await registerStorefrontRoutes(app);

    const res = await app.inject({ method: 'GET', url: '/storefront/scaffold/contracts' });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.ok).toBe(true);
    expect(body.version).toBe('storefront-scaffold-contracts-v1');
    expect(body.contractVersion).toBe('storefront-contract-v3');
    expect(body.authContractVersion).toBe('auth-contract-v3');
    expect(body.surfaces.headed.authManifest).toBe('/auth/qr/login/manifest');
    expect(body.surfaces.headed.authContracts).toBe('/auth/qr/contracts');
    expect(body.surfaces.headed.entitlementModes.directDownload).toContain('surface=headed&mode=direct_download');
    expect(body.surfaces.headless.authManifest).toBe('/auth/agent/login/manifest');
    expect(body.surfaces.headless.authContracts).toBe('/auth/agent/contracts');
    expect(body.surfaces.headless.entitlementModes.tokenizedAccess).toContain('surface=headless&mode=tokenized_access');
    expect(body.shared.playbook).toBe('/storefront/playbook/login-to-entitlement');
    expect(body.shared.downloadContracts).toBe('/storefront/download/contracts');
    expect(body.shared.surfaceContracts).toBe('/storefront/scaffold/surfaces/contracts');

    await app.close();
  });

  it('GET /storefront/scaffold/surfaces/contracts returns parallel headed + headless scaffold surface contracts', async () => {
    const app = fastify({ logger: false });
    await registerStorefrontRoutes(app);

    const res = await app.inject({ method: 'GET', url: '/storefront/scaffold/surfaces/contracts' });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.ok).toBe(true);
    expect(body.version).toBe('storefront-surface-contracts-v1');
    expect(body.headed.authSessionContracts).toBe('/auth/qr/session/contracts');
    expect(body.headless.authSessionContracts).toBe('/auth/agent/session/contracts');
    expect(body.headed.entitlement.direct).toContain('surface=headed&mode=direct_download');
    expect(body.headless.entitlement.tokenized).toContain('surface=headless&mode=tokenized_access');

    await app.close();
  });

  it('GET /storefront/scaffold/manifest returns auth + entitlement construction map', async () => {
    const app = fastify({ logger: false });
    await registerStorefrontRoutes(app);

    const res = await app.inject({ method: 'GET', url: '/storefront/scaffold/manifest' });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.ok).toBe(true);
    expect(body.version).toBe('auth-store-v3');
    expect(body.contractVersion).toBe('storefront-contract-v3');
    expect(body.authContractVersion).toBe('auth-contract-v3');
    expect(body.surfaces.headed).toContain('surface=headed');
    expect(body.surfaces.headless).toContain('surface=headless');
    expect(body.entitlements.headlessTokenized).toContain('surface=headless&mode=tokenized_access');
    expect(body.entitlements.examples).toBe('/storefront/entitlement/examples');
    expect(body.auth.humanQrApprove).toBe('/auth/qr/approve');
    expect(body.auth.humanQrStatus).toContain('/auth/qr/status/');
    expect(body.auth.agentSession).toBe('/auth/agent/session');
    expect(body.auth.agentContracts).toBe('/auth/agent/contracts');
    expect(body.handoffPlaybook).toBe('/storefront/playbook/login-to-entitlement');
    expect(body.bootstrap).toBe('/storefront/bootstrap/auth-store');
    expect(body.scaffoldContracts).toBe('/storefront/scaffold/contracts');
    expect(body.surfaceContracts).toBe('/storefront/scaffold/surfaces/contracts');
    expect(body.downloadContracts).toBe('/storefront/download/contracts');

    await app.close();
  });

  it('GET /storefront/bootstrap/auth-store returns lane-ordered auth/store construction bootstrap', async () => {
    const app = fastify({ logger: false });
    await registerStorefrontRoutes(app);

    const res = await app.inject({ method: 'GET', url: '/storefront/bootstrap/auth-store' });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.ok).toBe(true);
    expect(body.version).toBe('auth-store-bootstrap-v1');
    expect(body.laneOrder[0]).toBe('headed-human-lightning-login');
    expect(body.headed.login.example).toBe('/auth/qr/approve/example');
    expect(body.headless.login.example).toBe('/auth/agent/signed-challenge/example');
    expect(body.headless.entitlements.tokenized).toContain('surface=headless&mode=tokenized_access');
    expect(body.storefront.scaffoldManifest).toBe('/storefront/scaffold/manifest');
    expect(body.storefront.scaffoldContracts).toBe('/storefront/scaffold/contracts');
    expect(body.storefront.downloadContracts).toBe('/storefront/download/contracts');

    await app.close();
  });

  it('GET /storefront/contracts/auth-store/surfaces returns first-class auth + storefront handoff map', async () => {
    const app = fastify({ logger: false });
    await registerStorefrontRoutes(app);

    const res = await app.inject({ method: 'GET', url: '/storefront/contracts/auth-store/surfaces' });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.ok).toBe(true);
    expect(body.headed.authSessionContracts).toBe('/auth/session/contracts/surfaces');
    expect(body.headed.loginManifest).toBe('/auth/qr/login/manifest');
    expect(body.headless.authSessionContracts).toBe('/auth/session/contracts/surfaces');
    expect(body.headless.loginManifest).toBe('/auth/agent/login/manifest');
    expect(body.headless.entitlement.tokenized).toContain('surface=headless&mode=tokenized_access');
    expect(body.shared.bootstrap).toBe('/storefront/bootstrap/auth-store');

    await app.close();
  });

  it('GET /storefront/scaffold/parallel-lanes/manifest returns non-overlapping headed/headless lane manifest', async () => {
    const app = fastify({ logger: false });
    await registerStorefrontRoutes(app);

    const res = await app.inject({ method: 'GET', url: '/storefront/scaffold/parallel-lanes/manifest' });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.ok).toBe(true);
    expect(body.version).toBe('storefront-parallel-lanes-v1');
    expect(body.laneOrder[0]).toBe('headed-human-login-surface');
    expect(body.lanes.headed.authConstructionManifest).toBe('/auth/login/construction/manifest');
    expect(body.lanes.headless.authConstructionManifest).toBe('/auth/login/construction/manifest');
    expect(body.lanes.headed.entitlementModes.direct).toContain('surface=headed&mode=direct_download');
    expect(body.lanes.headless.entitlementModes.tokenized).toContain('surface=headless&mode=tokenized_access');
    expect(body.shared.authStoreSurfaces).toBe('/storefront/contracts/auth-store/surfaces');

    await app.close();
  });

  it('GET /storefront/scaffold/construction/checklist returns prioritized auth/store construction checklist + gates', async () => {
    const app = fastify({ logger: false });
    await registerStorefrontRoutes(app);

    const res = await app.inject({ method: 'GET', url: '/storefront/scaffold/construction/checklist' });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.ok).toBe(true);
    expect(body.version).toBe('storefront-construction-checklist-v1');
    expect(body.priorities.A.manifest).toBe('/auth/qr/login/manifest');
    expect(body.priorities.B.manifest).toBe('/auth/agent/login/manifest');
    expect(body.priorities.C.paths).toContain('/storefront/entitlement/path?surface=headed&mode=direct_download');
    expect(body.priorities.D.manifest).toBe('/storefront/scaffold/parallel-lanes/manifest');
    expect(body.gates.tests).toBe('npm test --silent');
    expect(body.gates.build).toBe('npm run build --silent');

    await app.close();
  });

  it('GET /storefront/scaffold/construction/readiness returns auth/store readiness snapshot for priorities A-D', async () => {
    const app = fastify({ logger: false });
    await registerStorefrontRoutes(app);

    const res = await app.inject({ method: 'GET', url: '/storefront/scaffold/construction/readiness' });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.ok).toBe(true);
    expect(body.version).toBe('storefront-construction-readiness-v1');
    expect(body.priorities.A.ready).toBe(true);
    expect(body.priorities.B.ready).toBe(true);
    expect(body.priorities.C.contracts).toContain('/storefront/entitlement/path?surface=headless&mode=tokenized_access');
    expect(body.priorities.D.contracts).toContain('/storefront/scaffold/parallel-lanes/manifest');
    expect(body.mergeGates.test).toBe('npm test --silent');
    expect(body.mergeGates.build).toBe('npm run build --silent');

    await app.close();
  });

  it('GET /storefront/scaffold/construction/handoff returns implementation-backed login-to-entitlement handoff map', async () => {
    const app = fastify({ logger: false });
    await registerStorefrontRoutes(app);

    const res = await app.inject({ method: 'GET', url: '/storefront/scaffold/construction/handoff' });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.ok).toBe(true);
    expect(body.version).toBe('storefront-construction-handoff-v1');
    expect(body.priorities.A.approve).toBe('/auth/qr/approve');
    expect(body.priorities.B.session).toBe('/auth/agent/session');
    expect(body.priorities.C.headlessTokenized).toContain('surface=headless&mode=tokenized_access');
    expect(body.priorities.D.laneManifest).toBe('/storefront/scaffold/parallel-lanes/manifest');
    expect(body.authRuntimeMap).toBe('/auth/storefront/construction/runtime');
    expect(body.mergeGates.test).toBe('npm test --silent');
    expect(body.mergeGates.build).toBe('npm run build --silent');

    await app.close();
  });

  it('GET /storefront/scaffold/construction/entitlement-consumption returns post-auth entitlement consumption contract', async () => {
    const app = fastify({ logger: false });
    await registerStorefrontRoutes(app);

    const res = await app.inject({ method: 'GET', url: '/storefront/scaffold/construction/entitlement-consumption' });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.ok).toBe(true);
    expect(body.version).toBe('storefront-entitlement-consumption-v1');
    expect(body.runtimeBridge.authLifecycle).toBe('/auth/storefront/construction/runtime/session-lifecycle');
    expect(body.lanes.headed.directDownload).toContain('surface=headed&mode=direct_download');
    expect(body.lanes.headless.acceptedSessionInputs).toContain('Authorization: Bearer <accessToken>');
    expect(body.mergeGates.test).toBe('npm test --silent');

    await app.close();
  });


  it('GET /storefront/scaffold/construction/shell-handlers returns headed shell handler contracts by default', async () => {
    const app = fastify({ logger: false });
    await registerStorefrontRoutes(app);

    const res = await app.inject({ method: 'GET', url: '/storefront/scaffold/construction/shell-handlers' });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.ok).toBe(true);
    expect(body.surface).toBe('headed');
    expect(body.handlers.authIngress).toBe('/auth/qr/start');
    expect(body.handlers.entitlementTokenized).toContain('surface=headed&mode=tokenized_access');
    expect(body.handoff.cookieName).toBe('bi_session');

    await app.close();
  });

  it('GET /storefront/scaffold/construction/shell-handlers supports headless lane contracts', async () => {
    const app = fastify({ logger: false });
    await registerStorefrontRoutes(app);

    const res = await app.inject({ method: 'GET', url: '/storefront/scaffold/construction/shell-handlers?surface=headless' });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.ok).toBe(true);
    expect(body.surface).toBe('headless');
    expect(body.handlers.authSession).toBe('/auth/agent/session');
    expect(body.handlers.entitlementPath).toContain('surface=headless&mode=tokenized_access');

    await app.close();
  });

  it('GET /storefront/scaffold/construction/entitlement-telemetry returns event schema + consumers', async () => {
    const app = fastify({ logger: false });
    await registerStorefrontRoutes(app);

    const res = await app.inject({ method: 'GET', url: '/storefront/scaffold/construction/entitlement-telemetry' });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.ok).toBe(true);
    expect(body.version).toBe('storefront-entitlement-telemetry-v1');
    expect(body.events.entitlementConsumed.fields).toContain('releaseId');
    expect(body.consumers.authExecutableHandoff).toBe('/auth/storefront/construction/runtime/executable-handoff');
    expect(body.mergeGates.test).toBe('npm test --silent');

    await app.close();
  });

  it('GET /storefront/scaffold/construction/entitlement-telemetry/runtime-emit-points returns concrete emit map', async () => {
    const app = fastify({ logger: false });
    await registerStorefrontRoutes(app);

    const res = await app.inject({ method: 'GET', url: '/storefront/scaffold/construction/entitlement-telemetry/runtime-emit-points' });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.ok).toBe(true);
    expect(body.version).toBe('storefront-entitlement-telemetry-runtime-v1');
    expect(body.emitPoints.pathResolution.endpoint).toBe('/storefront/entitlement/path');
    expect(body.emitPoints.downloadConsumption.surfaces.headless).toContain('Authorization: Bearer <accessToken>');
    expect(body.authUpstream.authEmitPoints).toBe('/auth/storefront/construction/runtime/telemetry-emit-points');

    await app.close();
  });


  it('GET /storefront/playbook/login-to-entitlement returns cross-surface auth-to-download map', async () => {
    const app = fastify({ logger: false });
    await registerStorefrontRoutes(app);

    const res = await app.inject({ method: 'GET', url: '/storefront/playbook/login-to-entitlement' });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.ok).toBe(true);
    expect(body.headed.login.approve).toBe('/auth/qr/approve');
    expect(body.headed.entitlementModes.direct_download).toContain('surface=headed&mode=direct_download');
    expect(body.headless.login.signedChallengeExample).toBe('/auth/agent/signed-challenge/example');
    expect(body.headless.entitlementModes.tokenized_access).toContain('surface=headless&mode=tokenized_access');
    expect(body.download.authorizationHeader ?? body.download.tokenized.authorizationHeader).toBeDefined();
    expect(body.download.tokenized.authorizationHeader).toBe('Bearer <accessToken>');

    await app.close();
  });
});
