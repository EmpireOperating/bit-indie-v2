import { describe, expect, it } from 'vitest';
import { buildApp } from './app.js';

describe('app', () => {
  it('GET /health returns ok', async () => {
    const app = await buildApp({ logger: false });
    const res = await app.inject({ method: 'GET', url: '/health' });
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toContain('application/json');
    expect(res.json()).toEqual({ ok: true });
    await app.close();
  });

  it('GET /ops/payouts/readiness reports not-ready when OpenNode config is missing', async () => {
    const prevKey = process.env.OPENNODE_API_KEY;
    const prevCallback = process.env.OPENNODE_WITHDRAWAL_CALLBACK_URL;

    process.env.OPENNODE_API_KEY = '';
    process.env.OPENNODE_WITHDRAWAL_CALLBACK_URL = '';

    const app = await buildApp({ logger: false });
    const res = await app.inject({ method: 'GET', url: '/ops/payouts/readiness' });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.ok).toBe(true);
    expect(body.payoutReady).toBe(false);
    expect(body.providerMode).toBe('mock');
    expect(body.reasons).toContain('OPENNODE_API_KEY missing');

    await app.close();
    process.env.OPENNODE_API_KEY = prevKey;
    process.env.OPENNODE_WITHDRAWAL_CALLBACK_URL = prevCallback;
  });

  it('GET /ops/payouts/readiness reports ready when OpenNode config is valid', async () => {
    const prevKey = process.env.OPENNODE_API_KEY;
    const prevCallback = process.env.OPENNODE_WITHDRAWAL_CALLBACK_URL;

    process.env.OPENNODE_API_KEY = 'test_key';
    process.env.OPENNODE_WITHDRAWAL_CALLBACK_URL = 'https://staging.bitindie.io/webhooks/opennode/withdrawals';

    const app = await buildApp({ logger: false });
    const res = await app.inject({ method: 'GET', url: '/ops/payouts/readiness' });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.ok).toBe(true);
    expect(body.payoutReady).toBe(true);
    expect(body.providerMode).toBe('opennode');
    expect(body.reasons).toEqual([]);

    await app.close();
    process.env.OPENNODE_API_KEY = prevKey;
    process.env.OPENNODE_WITHDRAWAL_CALLBACK_URL = prevCallback;
  });

  it('GET /ops/payouts/readiness rejects unsupported callback URL protocols', async () => {
    const prevKey = process.env.OPENNODE_API_KEY;
    const prevCallback = process.env.OPENNODE_WITHDRAWAL_CALLBACK_URL;

    process.env.OPENNODE_API_KEY = 'test_key';
    process.env.OPENNODE_WITHDRAWAL_CALLBACK_URL = 'ftp://staging.bitindie.io/webhooks/opennode/withdrawals';

    const app = await buildApp({ logger: false });
    const res = await app.inject({ method: 'GET', url: '/ops/payouts/readiness' });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.payoutReady).toBe(false);
    expect(body.reasons).toContain('OPENNODE_WITHDRAWAL_CALLBACK_URL invalid_protocol');

    await app.close();
    process.env.OPENNODE_API_KEY = prevKey;
    process.env.OPENNODE_WITHDRAWAL_CALLBACK_URL = prevCallback;
  });
});
