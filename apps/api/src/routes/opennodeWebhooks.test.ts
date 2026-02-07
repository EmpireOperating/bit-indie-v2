import crypto from 'node:crypto';
import * as querystring from 'node:querystring';
import fastify from 'fastify';
import { beforeEach, describe, expect, it, vi } from 'vitest';

// IMPORTANT: This test file must not import the real prisma module because it
// throws if DATABASE_URL is missing. We mock it before importing the routes.

type Payout = {
  id: string;
  provider: 'opennode';
  providerWithdrawalId: string;
  status: string;
  amountMsat: string;
  purchaseId: string;
  providerMetaJson: any;
};

function hmacHex(key: string, msg: string): string {
  return crypto.createHmac('sha256', key).update(msg).digest('hex');
}

function makeApp() {
  const app = fastify({ logger: false });
  app.addContentTypeParser(
    'application/x-www-form-urlencoded',
    { parseAs: 'string' },
    (_req: any, body: any, done: any) => {
      try {
        done(null, querystring.parse(body as string));
      } catch (e) {
        done(e as Error);
      }
    },
  );
  return app;
}

describe('OpenNode withdrawals webhook', () => {
  const apiKey = 'test-opennode-api-key';

  beforeEach(() => {
    vi.resetModules();
    process.env.OPENNODE_API_KEY = apiKey;
  });

  it('persists processed_at + fee into providerMetaJson.webhook when status=confirmed', async () => {
    const payout: Payout = {
      id: 'p1',
      provider: 'opennode',
      providerWithdrawalId: 'w1',
      status: 'SUBMITTED',
      amountMsat: '123',
      purchaseId: 'buy1',
      providerMetaJson: {},
    };

    const tx = {
      payout: {
        findUnique: vi.fn(async () => ({ ...payout })),
        update: vi.fn(async () => ({ ...payout, status: 'SENT' })),
      },
      ledgerEntry: {
        findFirst: vi.fn(async () => null),
        create: vi.fn(async () => ({ id: 'le1' })),
      },
    };

    const prismaMock = {
      payout: {
        findFirst: vi.fn(async () => ({ ...payout })),
        update: vi.fn(async () => ({ ...payout })),
      },
      ledgerEntry: {
        findFirst: vi.fn(async () => null),
      },
      $transaction: vi.fn(async (fn: any) => fn(tx)),
    };

    vi.doMock('../prisma.js', () => ({ prisma: prismaMock }));

    const { registerOpenNodeWebhookRoutes } = await import('./opennodeWebhooks.js');

    const app = makeApp();
    await registerOpenNodeWebhookRoutes(app);

    const body = {
      id: 'w1',
      status: 'confirmed',
      processed_at: '2026-02-07T09:25:00Z',
      fee: '42',
      hashed_order: hmacHex(apiKey, 'w1'),
    };

    const res = await app.inject({
      method: 'POST',
      url: '/webhooks/opennode/withdrawals',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      payload: new URLSearchParams(body as any).toString(),
    });

    expect(res.statusCode).toBe(200);

    expect(tx.payout.update).toHaveBeenCalledTimes(1);
    const updateArg = (tx.payout.update as any).mock.calls[0][0];
    expect(updateArg.data.providerMetaJson.webhook.processed_at).toBe(body.processed_at);
    expect(updateArg.data.providerMetaJson.webhook.fee).toBe(body.fee);
    // confirmed path force-clears error in webhook meta.
    expect(updateArg.data.providerMetaJson.webhook.error).toBeNull();
  });

  it('persists processed_at + fee into providerMetaJson.webhook when status=failed/error', async () => {
    const payout: Payout = {
      id: 'p2',
      provider: 'opennode',
      providerWithdrawalId: 'w2',
      status: 'SUBMITTED',
      amountMsat: '123',
      purchaseId: 'buy2',
      providerMetaJson: {},
    };

    const prismaMock = {
      payout: {
        findFirst: vi.fn(async () => ({ ...payout })),
        update: vi.fn(async () => ({ ...payout, status: 'FAILED' })),
      },
      $transaction: vi.fn(async (fn: any) => fn({})),
    };

    vi.doMock('../prisma.js', () => ({ prisma: prismaMock }));
    const { registerOpenNodeWebhookRoutes } = await import('./opennodeWebhooks.js');

    const app = makeApp();
    await registerOpenNodeWebhookRoutes(app);

    const body = {
      id: 'w2',
      status: 'failed',
      processed_at: '2026-02-07T09:25:00Z',
      fee: '100',
      error: 'insufficient funds',
      hashed_order: hmacHex(apiKey, 'w2'),
    };

    const res = await app.inject({
      method: 'POST',
      url: '/webhooks/opennode/withdrawals',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      payload: new URLSearchParams(body as any).toString(),
    });

    expect(res.statusCode).toBe(200);

    expect(prismaMock.payout.update).toHaveBeenCalledTimes(1);
    const updateArg = (prismaMock.payout.update as any).mock.calls[0][0];
    expect(updateArg.data.providerMetaJson.webhook.processed_at).toBe(body.processed_at);
    expect(updateArg.data.providerMetaJson.webhook.fee).toBe(body.fee);
    expect(updateArg.data.providerMetaJson.webhook.error).toBe(body.error);
  });

  it('persists processed_at + fee into providerMetaJson.webhook for unknown statuses (no status change)', async () => {
    const payout: Payout = {
      id: 'p3',
      provider: 'opennode',
      providerWithdrawalId: 'w3',
      status: 'SUBMITTED',
      amountMsat: '123',
      purchaseId: 'buy3',
      providerMetaJson: {},
    };

    const prismaMock = {
      payout: {
        findFirst: vi.fn(async () => ({ ...payout })),
        update: vi.fn(async () => ({ ...payout })),
      },
      $transaction: vi.fn(async (fn: any) => fn({})),
    };

    vi.doMock('../prisma.js', () => ({ prisma: prismaMock }));
    const { registerOpenNodeWebhookRoutes } = await import('./opennodeWebhooks.js');

    const app = makeApp();
    await registerOpenNodeWebhookRoutes(app);

    const body = {
      id: 'w3',
      status: 'weird_new_status',
      processed_at: '2026-02-07T09:25:00Z',
      fee: '7',
      hashed_order: hmacHex(apiKey, 'w3'),
    };

    const res = await app.inject({
      method: 'POST',
      url: '/webhooks/opennode/withdrawals',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      payload: new URLSearchParams(body as any).toString(),
    });

    expect(res.statusCode).toBe(200);

    expect(prismaMock.payout.update).toHaveBeenCalledTimes(1);
    const updateArg = (prismaMock.payout.update as any).mock.calls[0][0];
    expect(updateArg.data.providerMetaJson.webhook.processed_at).toBe(body.processed_at);
    expect(updateArg.data.providerMetaJson.webhook.fee).toBe(body.fee);
  });

  it('returns 500 when OPENNODE_API_KEY is not set (and does not attempt DB)', async () => {
    delete process.env.OPENNODE_API_KEY;

    const prismaMock = {
      payout: {
        findFirst: vi.fn(async () => null),
      },
    };

    vi.doMock('../prisma.js', () => ({ prisma: prismaMock }));
    const { registerOpenNodeWebhookRoutes } = await import('./opennodeWebhooks.js');

    const app = makeApp();
    await registerOpenNodeWebhookRoutes(app);

    const body = {
      id: 'w1',
      status: 'confirmed',
      processed_at: '2026-02-07T09:25:00Z',
      fee: '42',
      hashed_order: 'whatever',
    };

    const res = await app.inject({
      method: 'POST',
      url: '/webhooks/opennode/withdrawals',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      payload: new URLSearchParams(body as any).toString(),
    });

    expect(res.statusCode).toBe(500);
    expect(prismaMock.payout.findFirst).not.toHaveBeenCalled();
  });
});
