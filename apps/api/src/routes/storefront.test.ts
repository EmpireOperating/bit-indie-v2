import fastify from 'fastify';
import { describe, expect, it } from 'vitest';
import { registerStorefrontRoutes } from './storefront.js';

describe('storefront contract routes', () => {
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
    expect(body.headless.auth.challenge).toBe('/auth/agent/challenge');
    expect(body.headless.auth.session).toBe('/auth/agent/session');
    expect(body.headless.auth.tokenField).toBe('accessToken');
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

    const headlessRes = await app.inject({
      method: 'GET',
      url: '/storefront/scaffold?surface=headless',
    });
    expect(headlessRes.statusCode).toBe(200);
    const headless = headlessRes.json();
    expect(headless.surface).toBe('headless');
    expect(headless.authContract.challenge).toBe('/auth/agent/challenge');
    expect(headless.entitlementContract.supports).toContain('tokenized_access');

    await app.close();
  });
});
