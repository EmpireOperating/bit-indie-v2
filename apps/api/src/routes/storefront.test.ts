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
    expect(body.headless.download.entitlementInputs).toContain('accessToken');
    expect(body.headless.download.tokenizedEndpoint).toContain('accessToken=<accessToken>');

    await app.close();
  });
});
