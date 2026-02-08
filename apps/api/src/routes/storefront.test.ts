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
    expect(body.headed.login.cookieName).toBe('bi_session');
    expect(body.headed.login.qrStart).toBe('/auth/qr/start');
    expect(body.headed.login.qrApprove).toBe('/auth/qr/approve');
    expect(body.headed.login.qrStatusValues).toContain('approved');
    expect(body.headless.auth.challenge).toBe('/auth/agent/challenge');
    expect(body.headless.auth.session).toBe('/auth/agent/session');
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
    expect(headless.entitlementContract.supports).toContain('tokenized_access');
    expect(headless.storefrontLane.laneScaffold.entitlement).toContain('/storefront/entitlement/path?surface=headless');

    await app.close();
  });

  it('GET /storefront/scaffold/manifest returns auth + entitlement construction map', async () => {
    const app = fastify({ logger: false });
    await registerStorefrontRoutes(app);

    const res = await app.inject({ method: 'GET', url: '/storefront/scaffold/manifest' });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.ok).toBe(true);
    expect(body.version).toBe('auth-store-v2');
    expect(body.surfaces.headed).toContain('surface=headed');
    expect(body.surfaces.headless).toContain('surface=headless');
    expect(body.entitlements.headlessTokenized).toContain('surface=headless&mode=tokenized_access');
    expect(body.entitlements.examples).toBe('/storefront/entitlement/examples');
    expect(body.auth.humanQrApprove).toBe('/auth/qr/approve');
    expect(body.auth.agentSession).toBe('/auth/agent/session');

    await app.close();
  });
});
