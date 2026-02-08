import fastify from 'fastify';
import { afterEach, describe, expect, it } from 'vitest';

import { registerPayoutReadinessRoutes } from './payoutReadiness.js';

describe('payout readiness route', () => {
  const envKeys = ['OPENNODE_API_KEY', 'OPENNODE_WITHDRAWAL_CALLBACK_URL', 'OPENNODE_BASE_URL'] as const;

  afterEach(() => {
    for (const key of envKeys) delete process.env[key];
  });

  it('marks readiness false when OPENNODE_BASE_URL is configured with invalid protocol', async () => {
    process.env.OPENNODE_API_KEY = 'k_test';
    process.env.OPENNODE_WITHDRAWAL_CALLBACK_URL = 'https://example.com/webhooks/opennode/withdrawals';
    process.env.OPENNODE_BASE_URL = 'ftp://api.opennode.com';

    const app = fastify({ logger: false });
    await registerPayoutReadinessRoutes(app);

    const res = await app.inject({ method: 'GET', url: '/ops/payouts/readiness' });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.ok).toBe(true);
    expect(body.payoutReady).toBe(false);
    expect(body.reasons).toContain('OPENNODE_BASE_URL invalid_protocol');
    expect(body.checks.baseUrl).toEqual({
      configured: true,
      valid: false,
      value: 'ftp://api.opennode.com',
    });

    await app.close();
  });

  it('keeps readiness true when OPENNODE_BASE_URL is omitted but required fields are valid', async () => {
    process.env.OPENNODE_API_KEY = 'k_test';
    process.env.OPENNODE_WITHDRAWAL_CALLBACK_URL = 'https://example.com/webhooks/opennode/withdrawals';
    delete process.env.OPENNODE_BASE_URL;

    const app = fastify({ logger: false });
    await registerPayoutReadinessRoutes(app);

    const res = await app.inject({ method: 'GET', url: '/ops/payouts/readiness' });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.ok).toBe(true);
    expect(body.payoutReady).toBe(true);
    expect(body.reasons).toEqual([]);
    expect(body.checks.baseUrl).toEqual({
      configured: false,
      valid: true,
      value: null,
    });

    await app.close();
  });
});
