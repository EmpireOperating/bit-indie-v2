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
    expect(body.headed.login.flowContracts).toBe('/auth/qr/flow/contracts');
    expect(body.headed.login.qrStatusValues).toContain('approved');
    expect(body.headless.auth.challenge).toBe('/auth/agent/challenge');
    expect(body.headless.auth.session).toBe('/auth/agent/session');
    expect(body.headless.auth.contracts).toBe('/auth/agent/contracts');
    expect(body.headless.auth.flowContracts).toBe('/auth/agent/flow/contracts');
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

    const invalidSurface = await app.inject({
      method: 'GET',
      url: '/storefront/entitlement/path?surface=mobile&mode=tokenized_access',
    });
    expect(invalidSurface.statusCode).toBe(400);
    expect(invalidSurface.json().ok).toBe(false);
    expect(invalidSurface.json().error).toContain('surface must be one of');

    const invalidMode = await app.inject({
      method: 'GET',
      url: '/storefront/entitlement/path?surface=headed&mode=download_now',
    });
    expect(invalidMode.statusCode).toBe(400);
    expect(invalidMode.json().ok).toBe(false);
    expect(invalidMode.json().error).toContain('mode must be one of');

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
    expect(body.surfaceContracts).toBe('/storefront/entitlement/surfaces/contracts');

    await app.close();
  });

  it('GET /storefront/entitlement/surfaces/contracts returns headed + headless entitlement lane contracts', async () => {
    const app = fastify({ logger: false });
    await registerStorefrontRoutes(app);

    const res = await app.inject({ method: 'GET', url: '/storefront/entitlement/surfaces/contracts' });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.ok).toBe(true);
    expect(body.version).toBe('storefront-entitlement-surfaces-v1');
    expect(body.surfaces.headed.directDownload.path).toContain('surface=headed&mode=direct_download');
    expect(body.surfaces.headed.tokenizedAccess.cookie).toContain('bi_session');
    expect(body.surfaces.headless.tokenizedAccess.path).toContain('surface=headless&mode=tokenized_access');
    expect(body.surfaces.headless.unsupported.directDownload).toContain('surface=headless&mode=direct_download');
    expect(body.shared.contracts).toBe('/storefront/download/contracts');

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
    expect(body.execution.burstMode).toBe('two-wave-hybrid');
    expect(body.execution.nonOverlap).toBe('strict');
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

  it('GET /storefront/scaffold/construction/entitlement-telemetry/trace-fixtures returns cross-lane trace fixtures', async () => {
    const app = fastify({ logger: false });
    await registerStorefrontRoutes(app);

    const res = await app.inject({ method: 'GET', url: '/storefront/scaffold/construction/entitlement-telemetry/trace-fixtures' });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.ok).toBe(true);
    expect(body.version).toBe('storefront-entitlement-trace-fixtures-v1');
    expect(body.fixtures.headedHappyPath.steps).toContain('auth.handoff_ready');
    expect(body.fixtures.headlessHappyPath.sessionTransport).toBe('Authorization: Bearer <accessToken>');
    expect(body.upstream.authPayloadTemplates).toBe('/auth/storefront/construction/runtime/telemetry/payload-templates');

    await app.close();
  });

  it('GET /storefront/scaffold/construction/token-transport/contracts returns explicit token transport matrix for headed + headless lanes', async () => {
    const app = fastify({ logger: false });
    await registerStorefrontRoutes(app);

    const res = await app.inject({ method: 'GET', url: '/storefront/scaffold/construction/token-transport/contracts' });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.ok).toBe(true);
    expect(body.version).toBe('storefront-token-transport-contracts-v1');
    expect(body.surfaces.headed.acceptedTokenInputs).toContain('bi_session cookie');
    expect(body.surfaces.headless.acceptedTokenInputs).toContain('Authorization: Bearer <accessToken>');
    expect(body.directDownloadCompatibility.contract).toContain('surface=headed&mode=direct_download');
    expect(body.integrationChecks.authRuntimeChecks).toBe('/auth/storefront/construction/runtime/integration-checks');

    await app.close();
  });

  it('GET /storefront/scaffold/construction/release-download/acceptance-fixtures returns deterministic direct-download + fallback fixtures', async () => {
    const app = fastify({ logger: false });
    await registerStorefrontRoutes(app);

    const res = await app.inject({ method: 'GET', url: '/storefront/scaffold/construction/release-download/acceptance-fixtures' });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.ok).toBe(true);
    expect(body.version).toBe('storefront-release-download-acceptance-fixtures-v1');
    expect(body.fixtures.headedDirectDownload.entitlementPath).toContain('direct_download');
    expect(body.fixtures.headedTokenizedFallback.acceptedTokenInputs).toContain('bi_session cookie');
    expect(body.fixtures.headlessTokenizedAccess.acceptedTokenInputs).toContain('Authorization: Bearer <accessToken>');
    expect(body.upstream.authRuntimeAcceptance).toBe('/auth/storefront/construction/runtime/release-download-acceptance');

    await app.close();
  });

  it('GET /storefront/scaffold/construction/release-download/smoke-fixtures returns executable smoke fixtures for headed/headless download lanes', async () => {
    const app = fastify({ logger: false });
    await registerStorefrontRoutes(app);

    const res = await app.inject({ method: 'GET', url: '/storefront/scaffold/construction/release-download/smoke-fixtures' });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.ok).toBe(true);
    expect(body.version).toBe('storefront-release-download-smoke-fixtures-v1');
    expect(body.fixtures.headedDirectDownloadSmoke.entitlementPath).toContain('direct_download');
    expect(body.fixtures.headedTokenizedFallbackSmoke.acceptedTokenInputs).toContain('bi_session cookie');
    expect(body.fixtures.headlessTokenizedSmoke.acceptedTokenInputs).toContain('Authorization: Bearer <accessToken>');
    expect(body.upstream.authSmokeManifest).toBe('/auth/storefront/construction/runtime/release-download-smoke-manifest');

    await app.close();
  });

  it('GET /storefront/scaffold/construction/execution-checklist returns runnable headed/headless lane checklist contracts', async () => {
    const app = fastify({ logger: false });
    await registerStorefrontRoutes(app);

    const res = await app.inject({ method: 'GET', url: '/storefront/scaffold/construction/execution-checklist' });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.ok).toBe(true);
    expect(body.version).toBe('storefront-execution-checklist-v1');
    expect(body.lanes.headed.checklist[0]).toContain('/auth/qr/start');
    expect(body.lanes.headless.checklist[1]).toContain('/auth/agent/verify-hash');
    expect(body.dependencies.authExecutionLanes).toBe('/auth/storefront/construction/runtime/execution-lanes');

    await app.close();
  });

  it('GET /storefront/scaffold/construction/execution-receipts returns storefront wave receipts for one strict 2-wave burst', async () => {
    const app = fastify({ logger: false });
    await registerStorefrontRoutes(app);

    const res = await app.inject({ method: 'GET', url: '/storefront/scaffold/construction/execution-receipts' });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.ok).toBe(true);
    expect(body.version).toBe('storefront-execution-receipts-v1');
    expect(body.execution.wavePairing[0].priorities).toEqual(['A', 'B']);
    expect(body.execution.wavePairing[1].priorities).toEqual(['C', 'D']);
    expect(body.receipts.wave1AuthIngress.headed).toContain('/auth/qr/approve');
    expect(body.receipts.wave2EntitlementAndScaffold.headlessTokenized).toContain('surface=headless&mode=tokenized_access');
    expect(body.dependencies.authExecutionReceipts).toBe('/auth/storefront/construction/runtime/execution-receipts');

    await app.close();
  });

  it('GET /storefront/scaffold/construction/fixture-execution-manifest returns wave-2 entitlement/scaffold artifact consumption map', async () => {
    const app = fastify({ logger: false });
    await registerStorefrontRoutes(app);

    const res = await app.inject({ method: 'GET', url: '/storefront/scaffold/construction/fixture-execution-manifest' });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.ok).toBe(true);
    expect(body.version).toBe('storefront-fixture-execution-manifest-v1');
    expect(body.wave.priorities).toEqual(['C', 'D']);
    expect(body.prerequisites.authFixtureExecution).toBe('/auth/storefront/construction/runtime/fixture-execution-manifest');
    expect(body.headedLaneConsumption.entitlementPath).toContain('surface=headed&mode=tokenized_access');
    expect(body.headlessLaneConsumption.acceptedTokenInputs).toContain('Authorization: Bearer <accessToken>');
    expect(body.scaffoldSurfaces.parallelContracts).toBe('/storefront/scaffold/surfaces/contracts');

    await app.close();
  });

  it('GET /storefront/scaffold/construction/fixture-execution-runbook returns executable wave-2 runbook for C/D lanes', async () => {
    const app = fastify({ logger: false });
    await registerStorefrontRoutes(app);

    const res = await app.inject({ method: 'GET', url: '/storefront/scaffold/construction/fixture-execution-runbook' });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.ok).toBe(true);
    expect(body.version).toBe('storefront-fixture-execution-runbook-v1');
    expect(body.wave2Sequence[0].execute[0]).toContain('/storefront/entitlement/path?surface=headed&mode=tokenized_access');
    expect(body.wave2Sequence[1].execute).toContain('GET /storefront/scaffold/surfaces/contracts');
    expect(body.outputs.compatibilityGuard).toBe('/storefront/scaffold/construction/runtime/compatibility-guard');

    await app.close();
  });


  it('GET /storefront/scaffold/construction/fixture-payload-skeletons returns storefront payload skeletons paired to auth fixtures', async () => {
    const app = fastify({ logger: false });
    await registerStorefrontRoutes(app);

    const res = await app.inject({ method: 'GET', url: '/storefront/scaffold/construction/fixture-payload-skeletons' });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.ok).toBe(true);
    expect(body.version).toBe('storefront-fixture-payload-skeletons-v1');
    expect(body.payloadSkeletons.headedEntitlementProbe.path).toBe('headed-entitlement-probe.json');
    expect(body.payloadSkeletons.headlessEntitlementProbe.shape.surface).toBe('headless');
    expect(body.dependencies.authFixturePayloads).toBe('/auth/storefront/construction/runtime/fixture-payload-skeletons');

    await app.close();
  });

  it('GET /storefront/scaffold/construction/fixture-bundle-manifest returns single-file storefront fixture bundle contract', async () => {
    const app = fastify({ logger: false });
    await registerStorefrontRoutes(app);

    const res = await app.inject({ method: 'GET', url: '/storefront/scaffold/construction/fixture-bundle-manifest' });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.ok).toBe(true);
    expect(body.version).toBe('storefront-fixture-bundle-manifest-v1');
    expect(body.bundle.file).toBe('storefront-runtime-fixtures.bundle.json');
    expect(body.bundle.bundleVersion).toBe('storefront-runtime-fixtures.bundle.v2');
    expect(body.bundle.bundleDigest).toBe('sha256:storefront-runtime-fixtures-bundle-v2-contract-digest');
    expect(body.bundle.payloads).toHaveLength(2);
    expect(body.execution.companionAuthBundle).toBe('/auth/storefront/construction/runtime/fixture-bundle-manifest');
    expect(body.execution.compatibilityMatrix).toBe('/storefront/scaffold/construction/fixture-bundle-compatibility');
    expect(body.execution.executableExamples).toContain('/storefront/scaffold/construction/ci-command-templates');

    await app.close();
  });

  it('GET /storefront/scaffold/construction/runtime/fixture-bundle/materialize returns storefront runnable fixture surfaces consuming auth materialization', async () => {
    const app = fastify({ logger: false });
    await registerStorefrontRoutes(app);

    const res = await app.inject({ method: 'GET', url: '/storefront/scaffold/construction/runtime/fixture-bundle/materialize' });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.ok).toBe(true);
    expect(body.version).toBe('storefront-fixture-bundle-materialize-v1');
    expect(body.consumeFrom).toBe('/auth/storefront/construction/runtime/fixture-bundle/materialize');
    expect(body.lanes.headed.entitlementPathProbe).toContain('surface=headed&mode=tokenized_access');
    expect(body.lanes.headless.entitlementPathProbe).toContain('surface=headless&mode=tokenized_access');
    expect(body.commandTemplates.headed[1]).toContain('$HEADED_ACCESS_TOKEN');
    expect(body.commandTemplates.headless[1]).toContain('$HEADLESS_ACCESS_TOKEN');

    await app.close();
  });

  it('GET /storefront/scaffold/construction/fixture-bundle-compatibility returns storefront-side auth/store fixture compatibility mirror', async () => {
    const app = fastify({ logger: false });
    await registerStorefrontRoutes(app);

    const res = await app.inject({ method: 'GET', url: '/storefront/scaffold/construction/fixture-bundle-compatibility' });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.ok).toBe(true);
    expect(body.version).toBe('storefront-fixture-bundle-compatibility-v1');
    expect(body.bundles.storefront.bundleVersion).toBe('storefront-runtime-fixtures.bundle.v2');
    expect(body.bundles.auth.bundleVersion).toBe('auth-runtime-fixtures.bundle.v2');
    expect(body.compatibility.unknownPairPolicy).toBe('reject_ci_run');
    expect(body.dependencies.authCompatibilitySource).toBe('/auth/storefront/construction/runtime/fixture-bundle-compatibility');

    await app.close();
  });

  it('GET /storefront/scaffold/construction/ci-command-templates returns copy-paste storefront CI command templates', async () => {
    const app = fastify({ logger: false });
    await registerStorefrontRoutes(app);

    const res = await app.inject({ method: 'GET', url: '/storefront/scaffold/construction/ci-command-templates' });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.ok).toBe(true);
    expect(body.version).toBe('storefront-ci-command-templates-v1');
    expect(body.commands.headed[0]).toContain('mode=direct_download');
    expect(body.commands.headless[1]).toContain('/releases/$RELEASE_ID/download');
    expect(body.dependencies.authCiTemplates).toBe('/auth/storefront/construction/runtime/ci-command-templates');

    await app.close();
  });

  it('GET /storefront/scaffold/construction/surface-readiness-matrix returns strict headed/headless readiness matrix', async () => {
    const app = fastify({ logger: false });
    await registerStorefrontRoutes(app);

    const res = await app.inject({ method: 'GET', url: '/storefront/scaffold/construction/surface-readiness-matrix' });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.ok).toBe(true);
    expect(body.version).toBe('storefront-surface-readiness-matrix-v1');
    expect(body.execution.wavePairing).toEqual([
      ['A', 'B'],
      ['C', 'D'],
    ]);
    expect(body.surfaces.headed.auth.approve).toBe('/auth/qr/approve');
    expect(body.surfaces.headed.entitlement.directDownload).toContain('surface=headed&mode=direct_download');
    expect(body.surfaces.headless.auth.verifyHash).toBe('/auth/agent/verify-hash');
    expect(body.surfaces.headless.entitlement.tokenizedAccess).toContain('surface=headless&mode=tokenized_access');
    expect(body.dependencies.authPriorityCheckpoint).toBe('/auth/storefront/construction/runtime/priority-checkpoint');

    await app.close();
  });

  it('GET /storefront/scaffold/construction/ship-readiness returns storefront-side A/B/C/D ship readiness gate', async () => {
    const app = fastify({ logger: false });
    await registerStorefrontRoutes(app);

    const res = await app.inject({ method: 'GET', url: '/storefront/scaffold/construction/ship-readiness' });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.ok).toBe(true);
    expect(body.version).toBe('storefront-ship-readiness-v1');
    expect(body.execution.wavePairing).toEqual([
      ['A', 'B'],
      ['C', 'D'],
    ]);
    expect(body.priorities.A.ready).toBe(true);
    expect(body.priorities.B.surfacedBy).toContain('/auth/agent/session/contracts');
    expect(body.priorities.C.surfacedBy).toContain('/storefront/download/contracts');
    expect(body.priorities.D.surfacedBy).toContain('/storefront/scaffold/parallel-lanes/manifest');
    expect(body.dependencies.authShipReadiness).toBe('/auth/storefront/construction/runtime/ship-readiness');

    await app.close();
  });

  it('GET /storefront/entitlement/path/support-matrix returns wave-C entitlement support matrix across surfaces', async () => {
    const app = fastify({ logger: false });
    await registerStorefrontRoutes(app);

    const res = await app.inject({ method: 'GET', url: '/storefront/entitlement/path/support-matrix' });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.ok).toBe(true);
    expect(body.version).toBe('storefront-entitlement-path-support-matrix-v1');
    expect(body.execution.priority).toBe('C');
    expect(body.support.headed.direct_download.supported).toBe(true);
    expect(body.support.headless.direct_download.supported).toBe(false);
    expect(body.support.headless.direct_download.fallback).toContain('surface=headless&mode=tokenized_access');

    await app.close();
  });

  it('GET /storefront/scaffold/construction/runtime/compatibility-guard returns compact GO/NO_GO guard for C/D lanes', async () => {
    const app = fastify({ logger: false });
    await registerStorefrontRoutes(app);

    const res = await app.inject({ method: 'GET', url: '/storefront/scaffold/construction/runtime/compatibility-guard' });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.ok).toBe(true);
    expect(body.version).toBe('storefront-runtime-compatibility-guard-v1');
    expect(body.checkpoints.waveCD.ids).toEqual(['C', 'D']);
    expect(body.checkpointStatus.waveCD.ready).toBe(true);
    expect(body.checkpointStatus.waveCD.blockingReasons).toEqual([]);
    expect(body.decision).toBe('GO');

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

  it('GET /storefront/scaffold/construction/login-entitlement-bridge returns cross-surface login -> entitlement bridge contracts', async () => {
    const app = fastify({ logger: false });
    await registerStorefrontRoutes(app);

    const res = await app.inject({ method: 'GET', url: '/storefront/scaffold/construction/login-entitlement-bridge' });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.ok).toBe(true);
    expect(body.version).toBe('storefront-login-entitlement-bridge-v1');
    expect(body.headed.authLane.runtimeBootstrap).toBe('/auth/qr/runtime/bootstrap');
    expect(body.headed.authLane.approve).toBe('/auth/qr/approve');
    expect(body.headless.authLane.runtimeBootstrap).toBe('/auth/agent/runtime/bootstrap');
    expect(body.headless.authLane.verifyHash).toBe('/auth/agent/verify-hash');
    expect(body.headless.entitlementLane.acceptedTokenInputs).toContain('Authorization: Bearer <accessToken>');
    expect(body.integration.smokeFixtures).toBe('/storefront/scaffold/construction/release-download/smoke-fixtures');

    await app.close();
  });

  it('GET /storefront/scaffold/construction/runtime/entitlement-access-bridge returns wave-C/D entitlement bridge with auth manifest dependency', async () => {
    const app = fastify({ logger: false });
    await registerStorefrontRoutes(app);

    const res = await app.inject({ method: 'GET', url: '/storefront/scaffold/construction/runtime/entitlement-access-bridge' });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.ok).toBe(true);
    expect(body.version).toBe('storefront-entitlement-access-bridge-v1');
    expect(body.upstream.authEntitlementManifest).toBe('/auth/storefront/construction/runtime/entitlement-access-manifest');
    expect(body.surfaces.headed.directDownload).toContain('surface=headed&mode=direct_download');
    expect(body.surfaces.headless.tokenizedAccess).toContain('surface=headless&mode=tokenized_access');
    expect(body.surfaces.headless.directDownloadSupport.supported).toBe(false);
    expect(body.dependencies.supportMatrix).toBe('/storefront/entitlement/path/support-matrix');

    await app.close();
  });

  it('GET /storefront/scaffold/construction/runtime/entitlement-download-consumption returns storefront wave-D contract consuming auth entitlement download contracts', async () => {
    const app = fastify({ logger: false });
    await registerStorefrontRoutes(app);

    const res = await app.inject({ method: 'GET', url: '/storefront/scaffold/construction/runtime/entitlement-download-consumption' });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.ok).toBe(true);
    expect(body.version).toBe('storefront-entitlement-download-consumption-v1');
    expect(body.upstream.authEntitlementDownloadContracts).toBe('/auth/storefront/construction/runtime/entitlement-download-contracts');
    expect(body.consumption.headed.directDownload).toContain('buyerUserId=<buyerUserId>');
    expect(body.consumption.headless.acceptedTokenInputs).toContain('Authorization: Bearer <accessToken>');
    expect(body.dependencies.entitlementBridge).toBe('/storefront/scaffold/construction/runtime/entitlement-access-bridge');

    await app.close();
  });

  it('GET /storefront/scaffold/construction/runtime/release-download-acceptance-contract returns auth artifact to download acceptance wiring', async () => {
    const app = fastify({ logger: false });
    await registerStorefrontRoutes(app);

    const res = await app.inject({ method: 'GET', url: '/storefront/scaffold/construction/runtime/release-download-acceptance-contract' });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.ok).toBe(true);
    expect(body.version).toBe('storefront-release-download-acceptance-contract-v1');
    expect(body.upstream.authSessionArtifacts).toBe('/auth/storefront/construction/runtime/session-artifacts');
    expect(body.acceptance.headed.requiredAuthArtifacts).toContain('bi_session cookie');
    expect(body.acceptance.headless.requiredAuthArtifacts).toContain('Bearer accessToken');
    expect(body.dependencies.entitlementConsumption).toBe('/storefront/scaffold/construction/runtime/entitlement-download-consumption');

    await app.close();
  });

  it('GET /storefront/scaffold/construction/runtime/session-contract-consumption returns wave-2 storefront consumption of auth session compatibility contracts', async () => {
    const app = fastify({ logger: false });
    await registerStorefrontRoutes(app);

    const res = await app.inject({ method: 'GET', url: '/storefront/scaffold/construction/runtime/session-contract-consumption' });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.ok).toBe(true);
    expect(body.version).toBe('storefront-session-contract-consumption-v1');
    expect(body.upstream.authSessionCompatibility).toBe('/auth/storefront/construction/runtime/session-contract-compatibility');
    expect(body.consumption.headed.reads).toContain('bi_session cookie');
    expect(body.consumption.headless.reads).toContain('challengeHash');
    expect(body.boundaries.writesInStorefront).toContain('download acceptance responses');
    expect(body.dependencies.releaseAcceptance).toBe('/storefront/scaffold/construction/runtime/release-download-acceptance-contract');

    await app.close();
  });

  it('GET /storefront/scaffold/construction/runtime/release-download-acceptance-fixture-consumption returns wave-2 fixture consumption map for headed/headless download acceptance', async () => {
    const app = fastify({ logger: false });
    await registerStorefrontRoutes(app);

    const res = await app.inject({ method: 'GET', url: '/storefront/scaffold/construction/runtime/release-download-acceptance-fixture-consumption' });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.ok).toBe(true);
    expect(body.version).toBe('storefront-release-download-acceptance-fixture-consumption-v1');
    expect(body.upstream.authFixtureHandoff).toBe('/auth/storefront/construction/runtime/release-download-acceptance-fixture-handoff');
    expect(body.fixtureConsumption.headed.consumes).toContain('bi_session cookie');
    expect(body.fixtureConsumption.headless.consumes).toContain('challengeHash');
    expect(body.dependencies.sessionConsumption).toBe('/storefront/scaffold/construction/runtime/session-contract-consumption');

    await app.close();
  });

  it('GET /storefront/scaffold/construction/runtime/lane-consumption-ledger returns wave-2 C/D auth artifact consumption map', async () => {
    const app = fastify({ logger: false });
    await registerStorefrontRoutes(app);

    const res = await app.inject({ method: 'GET', url: '/storefront/scaffold/construction/runtime/lane-consumption-ledger' });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.ok).toBe(true);
    expect(body.version).toBe('storefront-lane-consumption-ledger-v1');
    expect(body.execution.activeWave).toBe('wave-2');
    expect(body.execution.priorities).toEqual(['C', 'D']);
    expect(body.execution.upstreamWave.source).toBe('/auth/storefront/construction/runtime/lane-ownership-ledger');
    expect(body.consumption.C.headed.direct).toContain('surface=headed&mode=direct_download');
    expect(body.consumption.C.authArtifactsConsumed).toContain('/auth/agent/session/contracts');
    expect(body.consumption.D.contracts).toContain('/storefront/scaffold/surfaces/contracts');
    expect(body.consumption.D.authArtifactsConsumed).toContain('/auth/agent/login/manifest');
    expect(body.boundaries.readsFromAuth).toContain('session contracts');
    expect(body.boundaries.writesInStorefront).toContain('scaffold surfaces');

    await app.close();
  });

  it('GET /storefront/scaffold/construction/runtime/next-sequential-wave-plan returns wave dependency and C/D execution lanes', async () => {
    const app = fastify({ logger: false });
    await registerStorefrontRoutes(app);

    const res = await app.inject({ method: 'GET', url: '/storefront/scaffold/construction/runtime/next-sequential-wave-plan' });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.ok).toBe(true);
    expect(body.version).toBe('storefront-next-sequential-wave-plan-v1');
    expect(body.sequence.wave1Dependency.priorities).toEqual(['A', 'B']);
    expect(body.sequence.wave1Dependency.source).toBe('/auth/storefront/construction/runtime/next-sequential-wave-plan');
    expect(body.sequence.wave2Execution.priorities).toEqual(['C', 'D']);
    expect(body.sequence.wave2Execution.lanes.C).toContain('/storefront/entitlement/path?surface=headless&mode=tokenized_access');
    expect(body.sequence.wave2Execution.lanes.D).toContain('/storefront/scaffold/surfaces/contracts');

    await app.close();
  });

  it('GET /storefront/scaffold/construction/runtime/storefront-lane-execution-board returns wave-2 ownership and auth artifact dependencies', async () => {
    const app = fastify({ logger: false });
    await registerStorefrontRoutes(app);

    const res = await app.inject({ method: 'GET', url: '/storefront/scaffold/construction/runtime/storefront-lane-execution-board' });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.ok).toBe(true);
    expect(body.version).toBe('storefront-lane-execution-board-v1');
    expect(body.upstreamWave1.source).toBe('/auth/storefront/construction/runtime/auth-lane-execution-board');
    expect(body.priorities.C.endpoints).toContain('/releases/:releaseId/download');
    expect(body.priorities.D.parallelLanesManifest).toBe('/storefront/scaffold/parallel-lanes/manifest');
    expect(body.nonOverlap.disallowedWrites).toContain('auth challenge/session issuance handlers');

    await app.close();
  });

});
