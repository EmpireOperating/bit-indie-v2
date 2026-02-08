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

  it('returns 503 when OPENNODE_API_KEY is missing (misconfigured)', async () => {
    const prismaMock = {
      payout: {
        findFirst: vi.fn(async () => null),
      },
    };

    vi.doMock('../prisma.js', () => ({ prisma: prismaMock }));
    const { registerOpenNodeWebhookRoutes } = await import('./opennodeWebhooks.js');

    process.env.OPENNODE_API_KEY = '';

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

    expect(res.statusCode).toBe(503);
    expect(prismaMock.payout.findFirst).not.toHaveBeenCalled();
  });

  it('returns 400 when id is missing', async () => {
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

    expect(res.statusCode).toBe(400);
    expect(prismaMock.payout.findFirst).not.toHaveBeenCalled();
  });

  it('returns 400 when status is missing', async () => {
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
      hashed_order: hmacHex(apiKey, 'w1'),
    };

    const res = await app.inject({
      method: 'POST',
      url: '/webhooks/opennode/withdrawals',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      payload: new URLSearchParams(body as any).toString(),
    });

    expect(res.statusCode).toBe(400);
    expect(prismaMock.payout.findFirst).not.toHaveBeenCalled();
  });

  it('returns 400 when hashed_order is missing', async () => {
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
    };

    const res = await app.inject({
      method: 'POST',
      url: '/webhooks/opennode/withdrawals',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      payload: new URLSearchParams(body as any).toString(),
    });

    expect(res.statusCode).toBe(400);
    expect(prismaMock.payout.findFirst).not.toHaveBeenCalled();
  });

  it('returns 401 when hashed_order HMAC does not match', async () => {
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
      hashed_order: 'definitely-wrong',
    };

    const res = await app.inject({
      method: 'POST',
      url: '/webhooks/opennode/withdrawals',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      payload: new URLSearchParams(body as any).toString(),
    });

    expect(res.statusCode).toBe(401);
    expect(prismaMock.payout.findFirst).not.toHaveBeenCalled();
  });

  it('accepts uppercase hashed_order hex digest', async () => {
    const prismaMock = {
      payout: {
        findFirst: vi.fn(async () => null),
        update: vi.fn(async () => null),
      },
      $transaction: vi.fn(async (_fn: any) => {
        throw new Error('should not start transaction when payout not found');
      }),
    };

    vi.doMock('../prisma.js', () => ({ prisma: prismaMock }));
    const { registerOpenNodeWebhookRoutes } = await import('./opennodeWebhooks.js');

    const app = makeApp();
    await registerOpenNodeWebhookRoutes(app);

    const body = {
      id: 'w-uppercase',
      status: 'confirmed',
      processed_at: '2026-02-07T09:25:00Z',
      fee: '42',
      hashed_order: hmacHex(apiKey, 'w-uppercase').toUpperCase(),
    };

    const res = await app.inject({
      method: 'POST',
      url: '/webhooks/opennode/withdrawals',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      payload: new URLSearchParams(body as any).toString(),
    });

    expect(res.statusCode).toBe(200);
    expect(prismaMock.payout.findFirst).toHaveBeenCalledTimes(1);
  });

  it('returns 200 when payout is not found (and does not attempt updates)', async () => {
    const prismaMock = {
      payout: {
        findFirst: vi.fn(async () => null),
        update: vi.fn(async () => null),
      },
      $transaction: vi.fn(async (_fn: any) => {
        throw new Error('should not start transaction when payout not found');
      }),
    };

    vi.doMock('../prisma.js', () => ({ prisma: prismaMock }));
    const { registerOpenNodeWebhookRoutes } = await import('./opennodeWebhooks.js');

    const app = makeApp();
    await registerOpenNodeWebhookRoutes(app);

    const body = {
      id: 'w404',
      status: 'confirmed',
      processed_at: '2026-02-07T09:25:00Z',
      fee: '42',
      hashed_order: hmacHex(apiKey, 'w404'),
    };

    const res = await app.inject({
      method: 'POST',
      url: '/webhooks/opennode/withdrawals',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      payload: new URLSearchParams(body as any).toString(),
    });

    expect(res.statusCode).toBe(200);

    expect(prismaMock.payout.findFirst).toHaveBeenCalledTimes(1);
    expect(prismaMock.payout.update).not.toHaveBeenCalled();
    expect(prismaMock.$transaction).not.toHaveBeenCalled();
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

  it('persists webhook meta even when payout is already SENT (confirmed webhook retries)', async () => {
    const payout: Payout = {
      id: 'p1',
      provider: 'opennode',
      providerWithdrawalId: 'w1',
      status: 'SENT',
      amountMsat: '123',
      purchaseId: 'buy1',
      providerMetaJson: { existing: true },
    };

    const tx = {
      payout: {
        findUnique: vi.fn(async () => ({ ...payout })),
        update: vi.fn(async () => ({ ...payout })),
      },
      ledgerEntry: {
        findFirst: vi.fn(async () => ({ id: 'le-existing' })),
        create: vi.fn(async () => {
          throw new Error('should not create ledger entry when one already exists');
        }),
      },
    };

    const prismaMock = {
      payout: {
        findFirst: vi.fn(async () => ({ ...payout })),
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
    expect(updateArg.data.status).toBeUndefined();
    expect(updateArg.data.confirmedAt).toBeUndefined();
    expect(updateArg.data.providerMetaJson.existing).toBe(true);
    expect(updateArg.data.providerMetaJson.webhook.processed_at).toBe(body.processed_at);
    expect(updateArg.data.providerMetaJson.webhook.fee).toBe(body.fee);
    expect(updateArg.data.providerMetaJson.webhook.error).toBeNull();
  });

  it('is idempotent when PAYOUT_SENT ledger entry already exists (does not create another)', async () => {
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
        findFirst: vi.fn(async () => ({ id: 'le-existing' })),
        create: vi.fn(async () => {
          throw new Error('should not create ledger entry when one already exists');
        }),
      },
    };

    const prismaMock = {
      payout: {
        findFirst: vi.fn(async () => ({ ...payout })),
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

    expect(tx.ledgerEntry.findFirst).toHaveBeenCalledTimes(1);
    expect(tx.ledgerEntry.create).not.toHaveBeenCalled();
  });

  it('accepts mixed-case/whitespace confirmed status and normalizes stored webhook status', async () => {
    const payout: Payout = {
      id: 'pMixedConfirmed',
      provider: 'opennode',
      providerWithdrawalId: 'wMixedConfirmed',
      status: 'SUBMITTED',
      amountMsat: '123',
      purchaseId: 'buyMixedConfirmed',
      providerMetaJson: {},
    };

    const tx = {
      payout: {
        findUnique: vi.fn(async () => ({ ...payout })),
        update: vi.fn(async () => ({ ...payout, status: 'SENT' })),
      },
      ledgerEntry: {
        findFirst: vi.fn(async () => null),
        create: vi.fn(async () => ({ id: 'le-mixed-confirmed' })),
      },
    };

    const prismaMock = {
      payout: {
        findFirst: vi.fn(async () => ({ ...payout })),
      },
      $transaction: vi.fn(async (fn: any) => fn(tx)),
    };

    vi.doMock('../prisma.js', () => ({ prisma: prismaMock }));
    const { registerOpenNodeWebhookRoutes } = await import('./opennodeWebhooks.js');

    const app = makeApp();
    await registerOpenNodeWebhookRoutes(app);

    const body = {
      id: 'wMixedConfirmed',
      status: '  ConFiRMed  ',
      processed_at: '2026-02-07T09:25:00Z',
      fee: '42',
      hashed_order: hmacHex(apiKey, 'wMixedConfirmed'),
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
    expect(updateArg.data.providerMetaJson.webhook.status).toBe('confirmed');
  });

  it('accepts mixed-case failed status and marks payout FAILED', async () => {
    const payout: Payout = {
      id: 'pMixedFailed',
      provider: 'opennode',
      providerWithdrawalId: 'wMixedFailed',
      status: 'SUBMITTED',
      amountMsat: '123',
      purchaseId: 'buyMixedFailed',
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
      id: 'wMixedFailed',
      status: ' FaILeD ',
      processed_at: '2026-02-07T09:25:00Z',
      fee: '100',
      error: 'insufficient funds',
      hashed_order: hmacHex(apiKey, 'wMixedFailed'),
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
    expect(updateArg.data.status).toBe('FAILED');
    expect(updateArg.data.providerMetaJson.webhook.status).toBe('failed');
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

  it('normalizes processed_at into processed_at_iso when timestamp is valid', async () => {
    const payout: Payout = {
      id: 'pProcessedAtValid',
      provider: 'opennode',
      providerWithdrawalId: 'wProcessedAtValid',
      status: 'SUBMITTED',
      amountMsat: '123',
      purchaseId: 'buyProcessedAtValid',
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
      id: 'wProcessedAtValid',
      status: 'failed',
      processed_at: ' 2026-02-07T09:25:00Z ',
      fee: '9',
      hashed_order: hmacHex(apiKey, 'wProcessedAtValid'),
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
    expect(updateArg.data.providerMetaJson.webhook.processed_at).toBe('2026-02-07T09:25:00Z');
    expect(updateArg.data.providerMetaJson.webhook.processed_at_iso).toBe('2026-02-07T09:25:00.000Z');
    expect(updateArg.data.providerMetaJson.webhook.processed_at_valid).toBe(true);
  });

  it('records invalid processed_at shape as non-blocking audit metadata', async () => {
    const payout: Payout = {
      id: 'pProcessedAtInvalid',
      provider: 'opennode',
      providerWithdrawalId: 'wProcessedAtInvalid',
      status: 'SUBMITTED',
      amountMsat: '123',
      purchaseId: 'buyProcessedAtInvalid',
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
      id: 'wProcessedAtInvalid',
      status: 'failed',
      processed_at: '  not-a-timestamp  ',
      fee: '7',
      hashed_order: hmacHex(apiKey, 'wProcessedAtInvalid'),
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
    expect(updateArg.data.providerMetaJson.webhook.processed_at).toBe('not-a-timestamp');
    expect(updateArg.data.providerMetaJson.webhook.processed_at_iso).toBeNull();
    expect(updateArg.data.providerMetaJson.webhook.processed_at_valid).toBe(false);
  });

  it('normalizes fee/amount audit metadata when numeric fields are parseable', async () => {
    const payout: Payout = {
      id: 'pNumericValid',
      provider: 'opennode',
      providerWithdrawalId: 'wNumericValid',
      status: 'SUBMITTED',
      amountMsat: '123',
      purchaseId: 'buyNumericValid',
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
      id: 'wNumericValid',
      status: 'failed',
      processed_at: '2026-02-07T09:25:00Z',
      amount: ' 12.5 ',
      fee: ' 0.75 ',
      hashed_order: hmacHex(apiKey, 'wNumericValid'),
    };

    const res = await app.inject({
      method: 'POST',
      url: '/webhooks/opennode/withdrawals',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      payload: new URLSearchParams(body as any).toString(),
    });

    expect(res.statusCode).toBe(200);

    const updateArg = (prismaMock.payout.update as any).mock.calls[0][0];
    expect(updateArg.data.providerMetaJson.webhook.amount).toBe('12.5');
    expect(updateArg.data.providerMetaJson.webhook.amount_number).toBe(12.5);
    expect(updateArg.data.providerMetaJson.webhook.amount_valid).toBe(true);
    expect(updateArg.data.providerMetaJson.webhook.fee_number).toBe(0.75);
    expect(updateArg.data.providerMetaJson.webhook.fee_valid).toBe(true);
  });

  it('records non-numeric fee/amount fields as invalid audit metadata without rejecting webhook', async () => {
    const payout: Payout = {
      id: 'pNumericInvalid',
      provider: 'opennode',
      providerWithdrawalId: 'wNumericInvalid',
      status: 'SUBMITTED',
      amountMsat: '123',
      purchaseId: 'buyNumericInvalid',
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
      id: 'wNumericInvalid',
      status: 'failed',
      processed_at: '2026-02-07T09:25:00Z',
      amount: 'n/a',
      fee: 'two sats',
      hashed_order: hmacHex(apiKey, 'wNumericInvalid'),
    };

    const res = await app.inject({
      method: 'POST',
      url: '/webhooks/opennode/withdrawals',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      payload: new URLSearchParams(body as any).toString(),
    });

    expect(res.statusCode).toBe(200);

    const updateArg = (prismaMock.payout.update as any).mock.calls[0][0];
    expect(updateArg.data.providerMetaJson.webhook.amount).toBe('n/a');
    expect(updateArg.data.providerMetaJson.webhook.amount_number).toBeNull();
    expect(updateArg.data.providerMetaJson.webhook.amount_valid).toBe(false);
    expect(updateArg.data.providerMetaJson.webhook.fee_number).toBeNull();
    expect(updateArg.data.providerMetaJson.webhook.fee_valid).toBe(false);
  });

  it('normalizes whitespace-only error values to null', async () => {
    const payout: Payout = {
      id: 'pErrorWhitespace',
      provider: 'opennode',
      providerWithdrawalId: 'wErrorWhitespace',
      status: 'SUBMITTED',
      amountMsat: '123',
      purchaseId: 'buyErrorWhitespace',
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
      id: 'wErrorWhitespace',
      status: 'failed',
      processed_at: '2026-02-07T09:25:00Z',
      fee: '1',
      error: '    ',
      hashed_order: hmacHex(apiKey, 'wErrorWhitespace'),
    };

    const res = await app.inject({
      method: 'POST',
      url: '/webhooks/opennode/withdrawals',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      payload: new URLSearchParams(body as any).toString(),
    });

    expect(res.statusCode).toBe(200);

    const updateArg = (prismaMock.payout.update as any).mock.calls[0][0];
    expect(updateArg.data.lastError).toBe('opennode withdrawal wErrorWhitespace status=failed');
    expect(updateArg.data.providerMetaJson.webhook.error).toBeNull();
    expect(updateArg.data.providerMetaJson.webhook.error_truncated).toBe(false);
  });

  it('truncates oversized error values and marks truncation in webhook metadata', async () => {
    const payout: Payout = {
      id: 'pErrorLong',
      provider: 'opennode',
      providerWithdrawalId: 'wErrorLong',
      status: 'SUBMITTED',
      amountMsat: '123',
      purchaseId: 'buyErrorLong',
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

    const longError = `  ${'e'.repeat(600)}  `;
    const res = await app.inject({
      method: 'POST',
      url: '/webhooks/opennode/withdrawals',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      payload: new URLSearchParams({
        id: 'wErrorLong',
        status: 'failed',
        processed_at: '2026-02-07T09:25:00Z',
        fee: '1',
        error: longError,
        hashed_order: hmacHex(apiKey, 'wErrorLong'),
      } as any).toString(),
    });

    expect(res.statusCode).toBe(200);

    const updateArg = (prismaMock.payout.update as any).mock.calls[0][0];
    expect(updateArg.data.lastError).toHaveLength(500);
    expect(updateArg.data.providerMetaJson.webhook.error).toHaveLength(500);
    expect(updateArg.data.providerMetaJson.webhook.error_truncated).toBe(true);
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

  it('returns 503 when OPENNODE_API_KEY is not set (and does not attempt DB)', async () => {
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

    expect(res.statusCode).toBe(503);
    expect(prismaMock.payout.findFirst).not.toHaveBeenCalled();
  });
});
