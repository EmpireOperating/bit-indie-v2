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

function configureFormBodyParser(app: ReturnType<typeof fastify>) {
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

function makeApp() {
  return configureFormBodyParser(fastify({ logger: false }));
}

function makeAppWithLogCapture(lines: string[]) {
  const stream = {
    write: (line: string) => {
      lines.push(line);
      return true;
    },
  };

  return configureFormBodyParser(
    fastify({
      logger: {
        level: 'warn',
        stream,
      },
    }),
  );
}

function parseLogEntries(lines: string[]): Array<Record<string, unknown>> {
  return lines
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => JSON.parse(line) as Record<string, unknown>);
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

  it('returns 400 and logs validation failure when id is missing', async () => {
    const prismaMock = {
      payout: {
        findFirst: vi.fn(async () => null),
      },
    };

    vi.doMock('../prisma.js', () => ({ prisma: prismaMock }));
    const { registerOpenNodeWebhookRoutes } = await import('./opennodeWebhooks.js');

    const logs: string[] = [];
    const app = makeAppWithLogCapture(logs);
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

    const warnLog = parseLogEntries(logs).find((entry) => entry.msg === 'opennode withdrawals webhook: missing id/hashed_order');
    expect(warnLog).toBeTruthy();
    expect(warnLog?.validationFailure).toMatchObject({
      reason: 'missing_id_or_hashed_order',
      withdrawal_id_present: false,
      status_present: true,
      status: 'confirmed',
      hashed_order_present: true,
    });
  });

  it('returns 400 and logs validation failure when status is missing', async () => {
    const prismaMock = {
      payout: {
        findFirst: vi.fn(async () => null),
      },
    };

    vi.doMock('../prisma.js', () => ({ prisma: prismaMock }));
    const { registerOpenNodeWebhookRoutes } = await import('./opennodeWebhooks.js');

    const logs: string[] = [];
    const app = makeAppWithLogCapture(logs);
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

    const warnLog = parseLogEntries(logs).find((entry) => entry.msg === 'opennode withdrawals webhook: missing status');
    expect(warnLog).toBeTruthy();
    expect(warnLog?.validationFailure).toMatchObject({
      reason: 'missing_status',
      withdrawal_id_present: true,
      status_present: false,
      status: '',
      status_known: false,
      hashed_order_present: true,
      hashed_order_valid_hex: true,
    });
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

  it('returns 401 and writes auth-failure shape metadata when hashed_order HMAC does not match', async () => {
    const prismaMock = {
      payout: {
        findFirst: vi.fn(async () => null),
      },
    };

    vi.doMock('../prisma.js', () => ({ prisma: prismaMock }));
    const { registerOpenNodeWebhookRoutes } = await import('./opennodeWebhooks.js');

    const logs: string[] = [];
    const app = makeAppWithLogCapture(logs);
    await registerOpenNodeWebhookRoutes(app);

    const body = {
      id: 'w1',
      status: 'confirmed',
      processed_at: '2026-02-07T09:25:00Z',
      fee: '42',
      hashed_order: ' sha256=definitely-wrong ',
    };

    const res = await app.inject({
      method: 'POST',
      url: '/webhooks/opennode/withdrawals',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      payload: new URLSearchParams(body as any).toString(),
    });

    expect(res.statusCode).toBe(401);
    expect(prismaMock.payout.findFirst).not.toHaveBeenCalled();

    const warnLog = parseLogEntries(logs).find((entry) => entry.msg === 'opennode withdrawals webhook: invalid hashed_order');
    expect(warnLog).toBeTruthy();
    expect(warnLog?.route).toBe('opennode.withdrawals');
    expect(warnLog?.authFailure).toMatchObject({
      reason: 'hashed_order_mismatch',
      withdrawal_id_present: true,
      withdrawal_id_length: 2,
      status: 'confirmed',
      status_known: true,
      hashed_order_prefixed: true,
      hashed_order_valid_hex: false,
      hashed_order_length: 16,
      hashed_order_expected_length: 64,
      hashed_order_length_matches_expected: false,
      hashed_order_has_non_hex_chars: true,
      hashed_order_had_surrounding_whitespace: true,
    });
    expect(warnLog?.authFailure).not.toHaveProperty('hashed_order');
    expect(warnLog?.authFailure).not.toHaveProperty('calculated_hmac');
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

  it('accepts sha256= prefixed hashed_order values', async () => {
    const payout: Payout = {
      id: 'pPrefix',
      provider: 'opennode',
      providerWithdrawalId: 'wPrefix',
      status: 'SUBMITTED',
      amountMsat: '123',
      purchaseId: 'buyPrefix',
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

    const logs: string[] = [];
    const app = makeAppWithLogCapture(logs);
    await registerOpenNodeWebhookRoutes(app);

    const body = {
      id: 'wPrefix',
      status: 'failed',
      processed_at: '2026-02-07T09:25:00Z',
      fee: '1',
      hashed_order: `sha256=${hmacHex(apiKey, 'wPrefix')}`,
    };

    const res = await app.inject({
      method: 'POST',
      url: '/webhooks/opennode/withdrawals',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      payload: new URLSearchParams(body as any).toString(),
    });

    expect(res.statusCode).toBe(200);
    const updateArg = (prismaMock.payout.update as any).mock.calls[0][0];
    expect(updateArg.data.providerMetaJson.webhook.hashed_order_prefixed).toBe(true);
    expect(updateArg.data.providerMetaJson.webhook.hashed_order_valid_hex).toBe(true);
    expect(updateArg.data.providerMetaJson.webhook.hashed_order_length).toBe(64);
    expect(updateArg.data.providerMetaJson.webhook.hashed_order_expected_length).toBe(64);
    expect(updateArg.data.providerMetaJson.webhook.hashed_order_length_matches_expected).toBe(true);
    expect(updateArg.data.providerMetaJson.webhook.hashed_order_has_non_hex_chars).toBe(false);

    const warnLog = parseLogEntries(logs).find((entry) => entry.msg === 'opennode withdrawals webhook: input normalization observed');
    expect(warnLog).toBeTruthy();
    expect(warnLog?.inputNormalization).toMatchObject({
      withdrawal_id_present: true,
      withdrawal_id_length: 7,
      id_had_surrounding_whitespace: false,
      status_had_surrounding_whitespace: false,
      hashed_order_had_surrounding_whitespace: false,
      hashed_order_prefixed: true,
    });
  });

  it('records hashed_order surrounding-whitespace telemetry without affecting verification', async () => {
    const payout: Payout = {
      id: 'pHashWhitespace',
      provider: 'opennode',
      providerWithdrawalId: 'wHashWhitespace',
      status: 'SUBMITTED',
      amountMsat: '123',
      purchaseId: 'buyHashWhitespace',
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

    const res = await app.inject({
      method: 'POST',
      url: '/webhooks/opennode/withdrawals',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      payload: new URLSearchParams({
        id: 'wHashWhitespace',
        status: 'failed',
        fee: '1',
        hashed_order: `  ${hmacHex(apiKey, 'wHashWhitespace')}  `,
      } as any).toString(),
    });

    expect(res.statusCode).toBe(200);
    const updateArg = (prismaMock.payout.update as any).mock.calls[0][0];
    expect(updateArg.data.providerMetaJson.webhook.hashed_order_had_surrounding_whitespace).toBe(true);
    expect(updateArg.data.providerMetaJson.webhook.hashed_order_length_matches_expected).toBe(true);
  });


  it('logs type-drift telemetry when non-withdrawal type is received', async () => {
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

    const logs: string[] = [];
    const app = makeAppWithLogCapture(logs);
    await registerOpenNodeWebhookRoutes(app);

    const res = await app.inject({
      method: 'POST',
      url: '/webhooks/opennode/withdrawals',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      payload: new URLSearchParams({
        id: 'wTypeDrift',
        status: 'confirmed',
        type: 'withdrawal_v2',
        hashed_order: hmacHex(apiKey, 'wTypeDrift'),
      } as any).toString(),
    });

    expect(res.statusCode).toBe(200);

    const warnLog = parseLogEntries(logs).find((entry) => entry.msg === 'opennode withdrawals webhook: unknown type received');
    expect(warnLog).toBeTruthy();
    expect(warnLog?.route).toBe('opennode.withdrawals');
    expect(warnLog?.typeDrift).toMatchObject({
      withdrawal_id_present: true,
      withdrawal_id_length: 10,
      type: 'withdrawal_v2',
      type_raw: 'withdrawal_v2',
      type_known: false,
    });
  });


  it('logs status/type mismatch metadata when known status arrives with unknown type', async () => {
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

    const logs: string[] = [];
    const app = makeAppWithLogCapture(logs);
    await registerOpenNodeWebhookRoutes(app);

    const res = await app.inject({
      method: 'POST',
      url: '/webhooks/opennode/withdrawals',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      payload: new URLSearchParams({
        id: 'wStatusTypeMismatch',
        status: 'confirmed',
        type: 'withdrawal_v2',
        hashed_order: hmacHex(apiKey, 'wStatusTypeMismatch'),
      } as any).toString(),
    });

    expect(res.statusCode).toBe(200);

    const warnLog = parseLogEntries(logs).find((entry) => entry.msg === 'opennode withdrawals webhook: status/type mismatch observed');
    expect(warnLog).toBeTruthy();
    expect(warnLog?.statusTypeMismatch).toMatchObject({
      withdrawal_id_present: true,
      withdrawal_id_length: 19,
      status: 'confirmed',
      status_raw: 'confirmed',
      status_known: true,
      type: 'withdrawal_v2',
      type_raw: 'withdrawal_v2',
      type_known: false,
    });
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

    const logs: string[] = [];
    const app = makeAppWithLogCapture(logs);
    await registerOpenNodeWebhookRoutes(app);

    const body = {
      id: 'w404',
      status: 'confirmed',
      type: 'withdrawal',
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

    const warnLog = parseLogEntries(logs).find((entry) => entry.msg === 'opennode withdrawals webhook: payout not found');
    expect(warnLog).toBeTruthy();
    expect(warnLog?.route).toBe('opennode.withdrawals');
    expect(warnLog?.lookupMiss).toMatchObject({
      withdrawal_id_present: true,
      withdrawal_id_length: 4,
      status: 'confirmed',
      status_known: true,
      type: 'withdrawal',
      type_known: true,
    });
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

    const logs: string[] = [];
    const app = makeAppWithLogCapture(logs);
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
    expect(updateArg.data.providerMetaJson.webhook.status_raw).toBe('ConFiRMed');
    expect(updateArg.data.providerMetaJson.webhook.status_known).toBe(true);
    expect(updateArg.data.providerMetaJson.webhook.status_kind).toBe('confirmed');
    expect(updateArg.data.providerMetaJson.webhook.status_had_surrounding_whitespace).toBe(true);

    const warnLog = parseLogEntries(logs).find((entry) => entry.msg === 'opennode withdrawals webhook: status normalization observed');
    expect(warnLog).toBeTruthy();
    expect(warnLog?.statusNormalization).toMatchObject({
      withdrawal_id_present: true,
      withdrawal_id_length: 15,
      status_raw: 'ConFiRMed',
      status: 'confirmed',
      status_known: true,
    });
  });


  it('logs type normalization metadata when webhook type requires casefolding', async () => {
    const payout: Payout = {
      id: 'pTypeNormalization',
      provider: 'opennode',
      providerWithdrawalId: 'wTypeNormalization',
      status: 'SUBMITTED',
      amountMsat: '123',
      purchaseId: 'buyTypeNormalization',
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

    const logs: string[] = [];
    const app = makeAppWithLogCapture(logs);
    await registerOpenNodeWebhookRoutes(app);

    const body = {
      id: 'wTypeNormalization',
      type: 'WiThDrAwAl',
      status: 'failed',
      fee: '1',
      hashed_order: hmacHex(apiKey, 'wTypeNormalization'),
    };

    const res = await app.inject({
      method: 'POST',
      url: '/webhooks/opennode/withdrawals',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      payload: new URLSearchParams(body as any).toString(),
    });

    expect(res.statusCode).toBe(200);

    const warnLog = parseLogEntries(logs).find((entry) => entry.msg === 'opennode withdrawals webhook: type normalization observed');
    expect(warnLog).toBeTruthy();
    expect(warnLog?.typeNormalization).toMatchObject({
      withdrawal_id_present: true,
      withdrawal_id_length: 18,
      type_raw: 'WiThDrAwAl',
      type: 'withdrawal',
      type_known: true,
    });
  });



  it('logs confirmed fee-equals-amount anomaly non-blockingly', async () => {
    const payout: Payout = {
      id: 'pConfirmedFeeEqualsAmount',
      provider: 'opennode',
      providerWithdrawalId: 'wConfirmedFeeEqualsAmount',
      status: 'SUBMITTED',
      amountMsat: '123',
      purchaseId: 'buyConfirmedFeeEqualsAmount',
      providerMetaJson: {},
    };

    const tx = {
      payout: {
        findUnique: vi.fn(async () => ({ ...payout })),
        update: vi.fn(async () => ({ ...payout, status: 'SENT' })),
      },
      ledgerEntry: {
        findFirst: vi.fn(async () => null),
        create: vi.fn(async () => ({ id: 'le-confirmed-fee-equal' })),
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

    const logs: string[] = [];
    const app = makeAppWithLogCapture(logs);
    await registerOpenNodeWebhookRoutes(app);

    const res = await app.inject({
      method: 'POST',
      url: '/webhooks/opennode/withdrawals',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      payload: new URLSearchParams({
        id: 'wConfirmedFeeEqualsAmount',
        status: 'confirmed',
        amount: '100',
        fee: '100',
        processed_at: '2026-02-07T09:25:00Z',
        hashed_order: hmacHex(apiKey, 'wConfirmedFeeEqualsAmount'),
      } as any).toString(),
    });

    expect(res.statusCode).toBe(200);

    const warnLog = parseLogEntries(logs).find((entry) => entry.msg === 'opennode withdrawals webhook: confirmed fee equals amount');
    expect(warnLog).toBeTruthy();
    expect(warnLog?.confirmedFeeEqualsAmount).toMatchObject({
      withdrawal_id_present: true,
      withdrawal_id_length: 25,
      status: 'confirmed',
      status_raw: 'confirmed',
      amount_valid: true,
      amount_number: 100,
      fee_valid: true,
      fee_number: 100,
      fee_equal_amount: true,
    });
  });

  it('logs confirmed fee-greater-than-amount anomaly non-blockingly', async () => {
    const payout: Payout = {
      id: 'pConfirmedFeeGreaterThanAmount',
      provider: 'opennode',
      providerWithdrawalId: 'wConfirmedFeeGreaterThanAmount',
      status: 'SUBMITTED',
      amountMsat: '123',
      purchaseId: 'buyConfirmedFeeGreaterThanAmount',
      providerMetaJson: {},
    };

    const tx = {
      payout: {
        findUnique: vi.fn(async () => ({ ...payout })),
        update: vi.fn(async () => ({ ...payout, status: 'SENT' })),
      },
      ledgerEntry: {
        findFirst: vi.fn(async () => null),
        create: vi.fn(async () => ({ id: 'le-confirmed-fee-greater' })),
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

    const logs: string[] = [];
    const app = makeAppWithLogCapture(logs);
    await registerOpenNodeWebhookRoutes(app);

    const res = await app.inject({
      method: 'POST',
      url: '/webhooks/opennode/withdrawals',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      payload: new URLSearchParams({
        id: 'wConfirmedFeeGreaterThanAmount',
        status: 'confirmed',
        amount: '90',
        fee: '100',
        processed_at: '2026-02-08T05:05:00Z',
        hashed_order: hmacHex(apiKey, 'wConfirmedFeeGreaterThanAmount'),
      } as any).toString(),
    });

    expect(res.statusCode).toBe(200);

    const warnLog = parseLogEntries(logs).find((entry) => entry.msg === 'opennode withdrawals webhook: confirmed fee greater than amount');
    expect(warnLog).toBeTruthy();
    expect(warnLog?.confirmedFeeGreaterThanAmount).toMatchObject({
      withdrawal_id_present: true,
      withdrawal_id_length: 30,
      status: 'confirmed',
      status_raw: 'confirmed',
      amount_valid: true,
      amount_number: 90,
      fee_valid: true,
      fee_number: 100,
      fee_greater_than_amount: true,
    });
  });

  it('logs confirmed zero-amount anomaly non-blockingly', async () => {
    const payout: Payout = {
      id: 'pConfirmedZeroAmount',
      provider: 'opennode',
      providerWithdrawalId: 'wConfirmedZeroAmount',
      status: 'SUBMITTED',
      amountMsat: '123',
      purchaseId: 'buyConfirmedZeroAmount',
      providerMetaJson: {},
    };

    const tx = {
      payout: {
        findUnique: vi.fn(async () => ({ ...payout })),
        update: vi.fn(async () => ({ ...payout, status: 'SENT' })),
      },
      ledgerEntry: {
        findFirst: vi.fn(async () => null),
        create: vi.fn(async () => ({ id: 'le-confirmed-zero-amount' })),
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

    const logs: string[] = [];
    const app = makeAppWithLogCapture(logs);
    await registerOpenNodeWebhookRoutes(app);

    const res = await app.inject({
      method: 'POST',
      url: '/webhooks/opennode/withdrawals',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      payload: new URLSearchParams({
        id: 'wConfirmedZeroAmount',
        status: 'confirmed',
        amount: '0',
        fee: '0',
        processed_at: '2026-02-08T04:05:00Z',
        hashed_order: hmacHex(apiKey, 'wConfirmedZeroAmount'),
      } as any).toString(),
    });

    expect(res.statusCode).toBe(200);

    const warnLog = parseLogEntries(logs).find((entry) => entry.msg === 'opennode withdrawals webhook: confirmed amount is zero');
    expect(warnLog).toBeTruthy();
    expect(warnLog?.confirmedZeroAmount).toMatchObject({
      withdrawal_id_present: true,
      withdrawal_id_length: 20,
      status: 'confirmed',
      status_raw: 'confirmed',
      amount_valid: true,
      amount_number: 0,
      fee_valid: true,
      fee_number: 0,
      amount_zero: true,
    });
  });

  it('logs confirmed zero-fee anomaly non-blockingly', async () => {
    const payout: Payout = {
      id: 'pConfirmedZeroFee',
      provider: 'opennode',
      providerWithdrawalId: 'wConfirmedZeroFee',
      status: 'SUBMITTED',
      amountMsat: '123',
      purchaseId: 'buyConfirmedZeroFee',
      providerMetaJson: {},
    };

    const tx = {
      payout: {
        findUnique: vi.fn(async () => ({ ...payout })),
        update: vi.fn(async () => ({ ...payout, status: 'SENT' })),
      },
      ledgerEntry: {
        findFirst: vi.fn(async () => null),
        create: vi.fn(async () => ({ id: 'le-confirmed-zero-fee' })),
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

    const logs: string[] = [];
    const app = makeAppWithLogCapture(logs);
    await registerOpenNodeWebhookRoutes(app);

    const res = await app.inject({
      method: 'POST',
      url: '/webhooks/opennode/withdrawals',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      payload: new URLSearchParams({
        id: 'wConfirmedZeroFee',
        status: 'confirmed',
        amount: '42',
        fee: '0',
        processed_at: '2026-02-08T04:05:00Z',
        hashed_order: hmacHex(apiKey, 'wConfirmedZeroFee'),
      } as any).toString(),
    });

    expect(res.statusCode).toBe(200);

    const warnLog = parseLogEntries(logs).find((entry) => entry.msg === 'opennode withdrawals webhook: confirmed fee is zero');
    expect(warnLog).toBeTruthy();
    expect(warnLog?.confirmedZeroFee).toMatchObject({
      withdrawal_id_present: true,
      withdrawal_id_length: 17,
      status: 'confirmed',
      status_raw: 'confirmed',
      amount_valid: true,
      amount_number: 42,
      fee_valid: true,
      fee_number: 0,
      fee_zero: true,
    });
  });

  it('logs confirmed negative-amount anomaly non-blockingly', async () => {
    const payout: Payout = {
      id: 'pConfirmedNegativeAmount',
      provider: 'opennode',
      providerWithdrawalId: 'wConfirmedNegativeAmount',
      status: 'SUBMITTED',
      amountMsat: '123',
      purchaseId: 'buyConfirmedNegativeAmount',
      providerMetaJson: {},
    };

    const tx = {
      payout: {
        findUnique: vi.fn(async () => ({ ...payout })),
        update: vi.fn(async () => ({ ...payout, status: 'SENT' })),
      },
      ledgerEntry: {
        findFirst: vi.fn(async () => null),
        create: vi.fn(async () => ({ id: 'le-confirmed-negative-amount' })),
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

    const logs: string[] = [];
    const app = makeAppWithLogCapture(logs);
    await registerOpenNodeWebhookRoutes(app);

    const res = await app.inject({
      method: 'POST',
      url: '/webhooks/opennode/withdrawals',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      payload: new URLSearchParams({
        id: 'wConfirmedNegativeAmount',
        status: 'confirmed',
        amount: '-1',
        fee: '0',
        processed_at: '2026-02-08T05:00:00Z',
        hashed_order: hmacHex(apiKey, 'wConfirmedNegativeAmount'),
      } as any).toString(),
    });

    expect(res.statusCode).toBe(200);

    const warnLog = parseLogEntries(logs).find((entry) => entry.msg === 'opennode withdrawals webhook: confirmed amount is negative');
    expect(warnLog).toBeTruthy();
    expect(warnLog?.confirmedNegativeAmount).toMatchObject({
      withdrawal_id_present: true,
      withdrawal_id_length: 24,
      status: 'confirmed',
      status_raw: 'confirmed',
      amount_valid: true,
      amount_number: -1,
      fee_valid: true,
      fee_number: 0,
      amount_negative: true,
    });
  });

  it('logs confirmed negative-fee anomaly non-blockingly', async () => {
    const payout: Payout = {
      id: 'pConfirmedNegativeFee',
      provider: 'opennode',
      providerWithdrawalId: 'wConfirmedNegativeFee',
      status: 'SUBMITTED',
      amountMsat: '123',
      purchaseId: 'buyConfirmedNegativeFee',
      providerMetaJson: {},
    };

    const tx = {
      payout: {
        findUnique: vi.fn(async () => ({ ...payout })),
        update: vi.fn(async () => ({ ...payout, status: 'SENT' })),
      },
      ledgerEntry: {
        findFirst: vi.fn(async () => null),
        create: vi.fn(async () => ({ id: 'le-confirmed-negative-fee' })),
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

    const logs: string[] = [];
    const app = makeAppWithLogCapture(logs);
    await registerOpenNodeWebhookRoutes(app);

    const res = await app.inject({
      method: 'POST',
      url: '/webhooks/opennode/withdrawals',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      payload: new URLSearchParams({
        id: 'wConfirmedNegativeFee',
        status: 'confirmed',
        amount: '100',
        fee: '-1',
        processed_at: '2026-02-08T04:55:00Z',
        hashed_order: hmacHex(apiKey, 'wConfirmedNegativeFee'),
      } as any).toString(),
    });

    expect(res.statusCode).toBe(200);

    const warnLog = parseLogEntries(logs).find((entry) => entry.msg === 'opennode withdrawals webhook: confirmed fee is negative');
    expect(warnLog).toBeTruthy();
    expect(warnLog?.confirmedNegativeFee).toMatchObject({
      withdrawal_id_present: true,
      withdrawal_id_length: 21,
      status: 'confirmed',
      status_raw: 'confirmed',
      amount_valid: true,
      amount_number: 100,
      fee_valid: true,
      fee_number: -1,
      fee_negative: true,
    });
  });

  it('logs confirmed timing anomaly when confirmed webhook omits processed_at', async () => {
    const payout: Payout = {
      id: 'pConfirmedTiming',
      provider: 'opennode',
      providerWithdrawalId: 'wConfirmedTiming',
      status: 'SUBMITTED',
      amountMsat: '123',
      purchaseId: 'buyConfirmedTiming',
      providerMetaJson: {},
    };

    const tx = {
      payout: {
        findUnique: vi.fn(async () => ({ ...payout })),
        update: vi.fn(async () => ({ ...payout, status: 'SENT' })),
      },
      ledgerEntry: {
        findFirst: vi.fn(async () => null),
        create: vi.fn(async () => ({ id: 'le-confirmed-timing' })),
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

    const logs: string[] = [];
    const app = makeAppWithLogCapture(logs);
    await registerOpenNodeWebhookRoutes(app);

    const res = await app.inject({
      method: 'POST',
      url: '/webhooks/opennode/withdrawals',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      payload: new URLSearchParams({
        id: 'wConfirmedTiming',
        status: 'confirmed',
        hashed_order: hmacHex(apiKey, 'wConfirmedTiming'),
      } as any).toString(),
    });

    expect(res.statusCode).toBe(200);

    const warnLog = parseLogEntries(logs).find((entry) => entry.msg === 'opennode withdrawals webhook: confirmed status missing/invalid processed_at');
    expect(warnLog).toBeTruthy();
    expect(warnLog?.confirmedTimingAnomaly).toMatchObject({
      withdrawal_id_present: true,
      withdrawal_id_length: 16,
      status: 'confirmed',
      status_raw: 'confirmed',
      processed_at: null,
      processed_at_iso: null,
      processed_at_valid: false,
    });
  });

  it('flags error-present confirmed payloads as audit anomalies while keeping confirmed behavior', async () => {
    const payout: Payout = {
      id: 'pConfirmedErrorSignal',
      provider: 'opennode',
      providerWithdrawalId: 'wConfirmedErrorSignal',
      status: 'SUBMITTED',
      amountMsat: '123',
      purchaseId: 'buyConfirmedErrorSignal',
      providerMetaJson: {},
    };

    const tx = {
      payout: {
        findUnique: vi.fn(async () => ({ ...payout })),
        update: vi.fn(async () => ({ ...payout, status: 'SENT' })),
      },
      ledgerEntry: {
        findFirst: vi.fn(async () => null),
        create: vi.fn(async () => ({ id: 'le-confirmed-error-signal' })),
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

    const logs: string[] = [];
    const app = makeAppWithLogCapture(logs);
    await registerOpenNodeWebhookRoutes(app);

    const res = await app.inject({
      method: 'POST',
      url: '/webhooks/opennode/withdrawals',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      payload: new URLSearchParams({
        id: 'wConfirmedErrorSignal',
        status: 'confirmed',
        fee: '1',
        error: 'provider sent stale error with confirmed',
        hashed_order: hmacHex(apiKey, 'wConfirmedErrorSignal'),
      } as any).toString(),
    });

    expect(res.statusCode).toBe(200);
    const updateArg = (tx.payout.update as any).mock.calls[0][0];
    expect(updateArg.data.providerMetaJson.webhook.error).toBeNull();
    expect(updateArg.data.providerMetaJson.webhook.error_present).toBe(true);
    expect(updateArg.data.providerMetaJson.webhook.error_present_on_confirmed).toBe(true);
    expect(updateArg.data.providerMetaJson.webhook.error_missing_for_failure).toBe(false);

    const warnLog = parseLogEntries(logs).find((entry) => entry.msg === 'opennode withdrawals webhook: confirmed status included error payload');
    expect(warnLog).toBeTruthy();
    expect(warnLog?.confirmedStatusError).toMatchObject({
      withdrawal_id_present: true,
      withdrawal_id_length: 21,
      status: 'confirmed',
      status_raw: 'confirmed',
      error_present: true,
      type: null,
      type_known: false,
    });
  });

  it('records error-present unknown statuses as additive audit drift telemetry', async () => {
    const payout: Payout = {
      id: 'pUnknownStatusErrorSignal',
      provider: 'opennode',
      providerWithdrawalId: 'wUnknownStatusErrorSignal',
      status: 'SUBMITTED',
      amountMsat: '123',
      purchaseId: 'buyUnknownStatusErrorSignal',
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

    const logs: string[] = [];
    const app = makeAppWithLogCapture(logs);
    await registerOpenNodeWebhookRoutes(app);

    const res = await app.inject({
      method: 'POST',
      url: '/webhooks/opennode/withdrawals',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      payload: new URLSearchParams({
        id: 'wUnknownStatusErrorSignal',
        status: 'provider_new_status',
        fee: '1',
        error: 'provider included error on unknown status',
        hashed_order: hmacHex(apiKey, 'wUnknownStatusErrorSignal'),
      } as any).toString(),
    });

    expect(res.statusCode).toBe(200);
    const updateArg = (prismaMock.payout.update as any).mock.calls[0][0];
    expect(updateArg.data.providerMetaJson.webhook.status_known).toBe(false);
    expect(updateArg.data.providerMetaJson.webhook.status_kind).toBe('unknown');
    expect(updateArg.data.providerMetaJson.webhook.status_had_surrounding_whitespace).toBe(false);
    expect(updateArg.data.providerMetaJson.webhook.error_present).toBe(true);
    expect(updateArg.data.providerMetaJson.webhook.error_present_on_unknown_status).toBe(true);
    expect(updateArg.data.providerMetaJson.webhook.error_missing_for_failure).toBe(false);

    const warnLog = parseLogEntries(logs).find((entry) => entry.msg === 'opennode withdrawals webhook: unknown status included error payload');
    expect(warnLog).toBeTruthy();
    expect(warnLog?.unknownStatusError).toMatchObject({
      withdrawal_id_present: true,
      withdrawal_id_length: 25,
      status: 'provider_new_status',
      status_raw: 'provider_new_status',
      error_present: true,
      type: null,
      type_known: false,
    });
  });


  it('logs provider-id mismatch telemetry when payout providerWithdrawalId diverges from inbound id', async () => {
    const payout: Payout = {
      id: 'pProviderIdMismatch',
      provider: 'opennode',
      providerWithdrawalId: 'wProviderIdMismatch-DB',
      status: 'SUBMITTED',
      amountMsat: '123',
      purchaseId: 'buyProviderIdMismatch',
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

    const logs: string[] = [];
    const app = makeAppWithLogCapture(logs);
    await registerOpenNodeWebhookRoutes(app);

    const res = await app.inject({
      method: 'POST',
      url: '/webhooks/opennode/withdrawals',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      payload: new URLSearchParams({
        id: 'wProviderIdMismatch',
        status: 'failed',
        error: 'provider state mismatch',
        fee: '1',
        hashed_order: hmacHex(apiKey, 'wProviderIdMismatch'),
      } as any).toString(),
    });

    expect(res.statusCode).toBe(200);

    const warnLog = parseLogEntries(logs).find((entry) => entry.msg === 'opennode withdrawals webhook: provider withdrawal id mismatch');
    expect(warnLog).toBeTruthy();
    expect(warnLog?.route).toBe('opennode.withdrawals');
    expect(warnLog?.providerIdMismatch).toMatchObject({
      withdrawal_id: 'wProviderIdMismatch',
      provider_withdrawal_id: 'wProviderIdMismatch-DB',
      provider_withdrawal_id_matches: false,
      provider_withdrawal_id_casefold_matches: false,
    });
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


  it('logs structured anomaly when failed/error status arrives without error details', async () => {
    const payout: Payout = {
      id: 'pFailureNoError',
      provider: 'opennode',
      providerWithdrawalId: 'wFailureNoError',
      status: 'SUBMITTED',
      amountMsat: '123',
      purchaseId: 'buyFailureNoError',
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

    const logs: string[] = [];
    const app = makeAppWithLogCapture(logs);
    await registerOpenNodeWebhookRoutes(app);

    const res = await app.inject({
      method: 'POST',
      url: '/webhooks/opennode/withdrawals',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      payload: new URLSearchParams({
        id: 'wFailureNoError',
        status: 'failed',
        fee: '100',
        hashed_order: hmacHex(apiKey, 'wFailureNoError'),
      } as any).toString(),
    });

    expect(res.statusCode).toBe(200);

    const warnLog = parseLogEntries(logs).find((entry) => entry.msg === 'opennode withdrawals webhook: failure status missing error');
    expect(warnLog).toBeTruthy();
    expect(warnLog?.route).toBe('opennode.withdrawals');
    expect(warnLog?.failureStatusAnomaly).toMatchObject({
      withdrawal_id_present: true,
      withdrawal_id_length: 15,
      status: 'failed',
      status_known: true,
      error_present: false,
      error_truncated: false,
    });
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

  it('adds processed_at timing audit flags for stale timestamps', async () => {
      const payout: Payout = {
        id: 'pProcessedAtStale',
        provider: 'opennode',
        providerWithdrawalId: 'wProcessedAtStale',
        status: 'SUBMITTED',
        amountMsat: '123',
        purchaseId: 'buyProcessedAtStale',
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
        id: 'wProcessedAtStale',
        status: 'failed',
        processed_at: '2026-01-01T00:00:00Z',
        fee: '7',
        hashed_order: hmacHex(apiKey, 'wProcessedAtStale'),
      };

      const res = await app.inject({
        method: 'POST',
        url: '/webhooks/opennode/withdrawals',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        payload: new URLSearchParams(body as any).toString(),
      });

      expect(res.statusCode).toBe(200);

      const updateArg = (prismaMock.payout.update as any).mock.calls[0][0];
      expect(updateArg.data.providerMetaJson.webhook.processed_at_age_seconds).toBeTypeOf('number');
      expect(updateArg.data.providerMetaJson.webhook.processed_at_in_future).toBe(false);
      expect(updateArg.data.providerMetaJson.webhook.processed_at_older_than_30d).toBe(true);
  });

  it('marks future processed_at timestamps without rejecting webhook', async () => {
      const payout: Payout = {
        id: 'pProcessedAtFuture',
        provider: 'opennode',
        providerWithdrawalId: 'wProcessedAtFuture',
        status: 'SUBMITTED',
        amountMsat: '123',
        purchaseId: 'buyProcessedAtFuture',
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
        id: 'wProcessedAtFuture',
        status: 'failed',
        processed_at: '2100-01-01T00:00:00Z',
        fee: '7',
        hashed_order: hmacHex(apiKey, 'wProcessedAtFuture'),
      };

      const res = await app.inject({
        method: 'POST',
        url: '/webhooks/opennode/withdrawals',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        payload: new URLSearchParams(body as any).toString(),
      });

      expect(res.statusCode).toBe(200);

      const updateArg = (prismaMock.payout.update as any).mock.calls[0][0];
      expect(updateArg.data.providerMetaJson.webhook.processed_at_age_seconds).toBeLessThan(0);
      expect(updateArg.data.providerMetaJson.webhook.processed_at_in_future).toBe(true);
      expect(updateArg.data.providerMetaJson.webhook.processed_at_older_than_30d).toBe(false);

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

    const logs: string[] = [];
    const app = makeAppWithLogCapture(logs);
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
    expect(updateArg.data.providerMetaJson.webhook.processed_at_age_seconds).toBeNull();
    expect(updateArg.data.providerMetaJson.webhook.processed_at_in_future).toBe(false);
    expect(updateArg.data.providerMetaJson.webhook.processed_at_older_than_30d).toBe(false);

    const warnLog = parseLogEntries(logs).find((entry) => entry.msg === 'opennode withdrawals webhook: processed_at anomaly observed');
    expect(warnLog).toBeTruthy();
    expect(warnLog?.route).toBe('opennode.withdrawals');
    expect(warnLog?.processedAtAnomaly).toMatchObject({
      withdrawal_id_present: true,
      withdrawal_id_length: 19,
      processed_at: 'not-a-timestamp',
      processed_at_iso: null,
      processed_at_valid: false,
      processed_at_in_future: false,
      processed_at_older_than_30d: false,
    });

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
    expect(updateArg.data.providerMetaJson.webhook.amount_decimal_places).toBe(1);
    expect(updateArg.data.providerMetaJson.webhook.amount_uses_scientific_notation).toBe(false);
    expect(updateArg.data.providerMetaJson.webhook.fee_number).toBe(0.75);
    expect(updateArg.data.providerMetaJson.webhook.fee_valid).toBe(true);
    expect(updateArg.data.providerMetaJson.webhook.fee_decimal_places).toBe(2);
    expect(updateArg.data.providerMetaJson.webhook.fee_uses_scientific_notation).toBe(false);
  });

  it('records numeric shape telemetry for scientific notation and leading plus values', async () => {
    const payout: Payout = {
      id: 'pNumericShapeTelemetry',
      provider: 'opennode',
      providerWithdrawalId: 'wNumericShapeTelemetry',
      status: 'SUBMITTED',
      amountMsat: '123',
      purchaseId: 'buyNumericShapeTelemetry',
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

    const res = await app.inject({
      method: 'POST',
      url: '/webhooks/opennode/withdrawals',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      payload: new URLSearchParams({
        id: 'wNumericShapeTelemetry',
        status: 'failed',
        amount: '+1.25e1',
        fee: '6E-1',
        hashed_order: hmacHex(apiKey, 'wNumericShapeTelemetry'),
      } as any).toString(),
    });

    expect(res.statusCode).toBe(200);

    const updateArg = (prismaMock.payout.update as any).mock.calls[0][0];
    expect(updateArg.data.providerMetaJson.webhook.amount_uses_scientific_notation).toBe(true);
    expect(updateArg.data.providerMetaJson.webhook.amount_has_leading_plus).toBe(true);
    expect(updateArg.data.providerMetaJson.webhook.amount_decimal_places).toBe(2);
    expect(updateArg.data.providerMetaJson.webhook.fee_uses_scientific_notation).toBe(true);
    expect(updateArg.data.providerMetaJson.webhook.fee_has_leading_plus).toBe(false);
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
    expect(updateArg.data.providerMetaJson.webhook.amount_decimal_places).toBe(0);
    expect(updateArg.data.providerMetaJson.webhook.amount_uses_scientific_notation).toBe(false);
    expect(updateArg.data.providerMetaJson.webhook.fee_number).toBeNull();
    expect(updateArg.data.providerMetaJson.webhook.fee_valid).toBe(false);
    expect(updateArg.data.providerMetaJson.webhook.fee_decimal_places).toBe(0);
    expect(updateArg.data.providerMetaJson.webhook.fee_uses_scientific_notation).toBe(false);
  });

  it('adds amount/fee anomaly flags when numeric fields indicate negative or zero values', async () => {
    const payout: Payout = {
      id: 'pAmountFeeAnomaly',
      provider: 'opennode',
      providerWithdrawalId: 'wAmountFeeAnomaly',
      status: 'SUBMITTED',
      amountMsat: '123',
      purchaseId: 'buyAmountFeeAnomaly',
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

    const logs: string[] = [];
    const app = makeAppWithLogCapture(logs);
    await registerOpenNodeWebhookRoutes(app);

    const res = await app.inject({
      method: 'POST',
      url: '/webhooks/opennode/withdrawals',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      payload: new URLSearchParams({
        id: 'wAmountFeeAnomaly',
        status: 'failed',
        amount: '0',
        fee: '-1',
        hashed_order: hmacHex(apiKey, 'wAmountFeeAnomaly'),
      } as any).toString(),
    });

    expect(res.statusCode).toBe(200);
    const updateArg = (prismaMock.payout.update as any).mock.calls[0][0];
    expect(updateArg.data.providerMetaJson.webhook.amount_zero).toBe(true);
    expect(updateArg.data.providerMetaJson.webhook.amount_negative).toBe(false);
    expect(updateArg.data.providerMetaJson.webhook.fee_zero).toBe(false);
    expect(updateArg.data.providerMetaJson.webhook.fee_negative).toBe(true);

    const warnLog = parseLogEntries(logs).find((entry) => entry.msg === 'opennode withdrawals webhook: numeric value anomaly observed');
    expect(warnLog).toBeTruthy();
    expect(warnLog?.valueAnomaly).toMatchObject({
      withdrawal_id_present: true,
      withdrawal_id_length: 17,
      amount_valid: true,
      fee_valid: true,
      amount_negative: false,
      fee_negative: true,
      fee_greater_than_amount: false,
    });
  });

  it('adds amount/fee comparison flags when both numeric fields are parseable', async () => {
    const payout: Payout = {
      id: 'pAmountFeeCompare',
      provider: 'opennode',
      providerWithdrawalId: 'wAmountFeeCompare',
      status: 'SUBMITTED',
      amountMsat: '123',
      purchaseId: 'buyAmountFeeCompare',
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

    const res = await app.inject({
      method: 'POST',
      url: '/webhooks/opennode/withdrawals',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      payload: new URLSearchParams({
        id: 'wAmountFeeCompare',
        status: 'failed',
        amount: '2',
        fee: '2',
        hashed_order: hmacHex(apiKey, 'wAmountFeeCompare'),
      } as any).toString(),
    });

    expect(res.statusCode).toBe(200);
    const updateArg = (prismaMock.payout.update as any).mock.calls[0][0];
    expect(updateArg.data.providerMetaJson.webhook.fee_equal_amount).toBe(true);
    expect(updateArg.data.providerMetaJson.webhook.fee_greater_than_amount).toBe(false);
  });

  it('marks bech32/base58-looking address payloads as valid audit metadata', async () => {
    const payout: Payout = {
      id: 'pAddressValid',
      provider: 'opennode',
      providerWithdrawalId: 'wAddressValid',
      status: 'SUBMITTED',
      amountMsat: '123',
      purchaseId: 'buyAddressValid',
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

    const res = await app.inject({
      method: 'POST',
      url: '/webhooks/opennode/withdrawals',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      payload: new URLSearchParams({
        id: 'wAddressValid',
        status: 'failed',
        processed_at: '2026-02-07T09:25:00Z',
        fee: '1',
        address: '  bc1qw508d6qejxtdg4y5r3zarvary0c5xw7k8zfx4  ',
        hashed_order: hmacHex(apiKey, 'wAddressValid'),
      } as any).toString(),
    });

    expect(res.statusCode).toBe(200);
    const updateArg = (prismaMock.payout.update as any).mock.calls[0][0];
    expect(updateArg.data.providerMetaJson.webhook.address).toBe('bc1qw508d6qejxtdg4y5r3zarvary0c5xw7k8zfx4');
    expect(updateArg.data.providerMetaJson.webhook.address_valid).toBe(true);
    expect(updateArg.data.providerMetaJson.webhook.address_kind).toBe('bech32');
  });

  it('records malformed address payloads as invalid audit metadata without rejection', async () => {
    const payout: Payout = {
      id: 'pAddressInvalid',
      provider: 'opennode',
      providerWithdrawalId: 'wAddressInvalid',
      status: 'SUBMITTED',
      amountMsat: '123',
      purchaseId: 'buyAddressInvalid',
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

    const logs: string[] = [];
    const app = makeAppWithLogCapture(logs);
    await registerOpenNodeWebhookRoutes(app);

    const res = await app.inject({
      method: 'POST',
      url: '/webhooks/opennode/withdrawals',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      payload: new URLSearchParams({
        id: 'wAddressInvalid',
        status: 'failed',
        processed_at: '2026-02-07T09:25:00Z',
        fee: '1',
        address: ' not-a-btc-address ',
        hashed_order: hmacHex(apiKey, 'wAddressInvalid'),
      } as any).toString(),
    });

    expect(res.statusCode).toBe(200);
    const updateArg = (prismaMock.payout.update as any).mock.calls[0][0];
    expect(updateArg.data.providerMetaJson.webhook.address).toBe('not-a-btc-address');
    expect(updateArg.data.providerMetaJson.webhook.address_valid).toBe(false);
    expect(updateArg.data.providerMetaJson.webhook.address_kind).toBe('unknown');

    const warnLog = parseLogEntries(logs).find((entry) => entry.msg === 'opennode withdrawals webhook: address anomaly observed');
    expect(warnLog).toBeTruthy();
    expect(warnLog?.addressAnomaly).toMatchObject({
      withdrawal_id_present: true,
      withdrawal_id_length: 15,
      address_present: true,
      address: 'not-a-btc-address',
      address_valid: false,
      address_kind: 'unknown',
    });
  });

  it('trims and persists reference audit metadata without changing webhook acceptance', async () => {
    const payout: Payout = {
      id: 'pReferenceTrimmed',
      provider: 'opennode',
      providerWithdrawalId: 'wReferenceTrimmed',
      status: 'SUBMITTED',
      amountMsat: '123',
      purchaseId: 'buyReferenceTrimmed',
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

    const res = await app.inject({
      method: 'POST',
      url: '/webhooks/opennode/withdrawals',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      payload: new URLSearchParams({
        id: 'wReferenceTrimmed',
        status: 'failed',
        processed_at: '2026-02-07T09:25:00Z',
        fee: '1',
        reference: '  payout_ref_123  ',
        hashed_order: hmacHex(apiKey, 'wReferenceTrimmed'),
      } as any).toString(),
    });

    expect(res.statusCode).toBe(200);
    const updateArg = (prismaMock.payout.update as any).mock.calls[0][0];
    expect(updateArg.data.providerMetaJson.webhook.reference).toBe('payout_ref_123');
    expect(updateArg.data.providerMetaJson.webhook.reference_truncated).toBe(false);
  });

  it('truncates oversized reference values and annotates truncation in webhook metadata', async () => {
    const payout: Payout = {
      id: 'pReferenceLong',
      provider: 'opennode',
      providerWithdrawalId: 'wReferenceLong',
      status: 'SUBMITTED',
      amountMsat: '123',
      purchaseId: 'buyReferenceLong',
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

    const logs: string[] = [];
    const app = makeAppWithLogCapture(logs);
    await registerOpenNodeWebhookRoutes(app);

    const longReference = `  ${'r'.repeat(250)}  `;
    const res = await app.inject({
      method: 'POST',
      url: '/webhooks/opennode/withdrawals',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      payload: new URLSearchParams({
        id: 'wReferenceLong',
        status: 'failed',
        processed_at: '2026-02-07T09:25:00Z',
        fee: '1',
        reference: longReference,
        hashed_order: hmacHex(apiKey, 'wReferenceLong'),
      } as any).toString(),
    });

    expect(res.statusCode).toBe(200);
    const updateArg = (prismaMock.payout.update as any).mock.calls[0][0];
    expect(updateArg.data.providerMetaJson.webhook.reference).toHaveLength(200);
    expect(updateArg.data.providerMetaJson.webhook.reference_truncated).toBe(true);

    const warnLog = parseLogEntries(logs).find((entry) => entry.msg === 'opennode withdrawals webhook: reference anomaly observed');
    expect(warnLog).toBeTruthy();
    expect(warnLog?.referenceAnomaly).toMatchObject({
      withdrawal_id_present: true,
      withdrawal_id_length: 14,
      reference_present: true,
      reference_length: 200,
      reference_truncated: true,
    });
  });

  it('normalizes mixed-case webhook type values and marks known withdrawal type', async () => {
    const payout: Payout = {
      id: 'pTypeKnown',
      provider: 'opennode',
      providerWithdrawalId: 'wTypeKnown',
      status: 'SUBMITTED',
      amountMsat: '123',
      purchaseId: 'buyTypeKnown',
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

    const res = await app.inject({
      method: 'POST',
      url: '/webhooks/opennode/withdrawals',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      payload: new URLSearchParams({
        id: 'wTypeKnown',
        status: 'failed',
        type: '  WiTHDrawAl  ',
        fee: '1',
        hashed_order: hmacHex(apiKey, 'wTypeKnown'),
      } as any).toString(),
    });

    expect(res.statusCode).toBe(200);
    const updateArg = (prismaMock.payout.update as any).mock.calls[0][0];
    expect(updateArg.data.providerMetaJson.webhook.type).toBe('withdrawal');
    expect(updateArg.data.providerMetaJson.webhook.type_raw).toBe('WiTHDrawAl');
    expect(updateArg.data.providerMetaJson.webhook.type_known).toBe(true);
  });

  it('records unknown webhook type values as non-blocking audit metadata', async () => {
    const payout: Payout = {
      id: 'pTypeUnknown',
      provider: 'opennode',
      providerWithdrawalId: 'wTypeUnknown',
      status: 'SUBMITTED',
      amountMsat: '123',
      purchaseId: 'buyTypeUnknown',
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

    const res = await app.inject({
      method: 'POST',
      url: '/webhooks/opennode/withdrawals',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      payload: new URLSearchParams({
        id: 'wTypeUnknown',
        status: 'failed',
        type: 'something_new',
        fee: '1',
        hashed_order: hmacHex(apiKey, 'wTypeUnknown'),
      } as any).toString(),
    });

    expect(res.statusCode).toBe(200);
    const updateArg = (prismaMock.payout.update as any).mock.calls[0][0];
    expect(updateArg.data.providerMetaJson.webhook.type).toBe('something_new');
    expect(updateArg.data.providerMetaJson.webhook.type_raw).toBe('something_new');
    expect(updateArg.data.providerMetaJson.webhook.type_known).toBe(false);
  });

  it('records normalized webhook id audit metadata including surrounding-whitespace signal', async () => {
    const payout: Payout = {
      id: 'pWebhookIdMeta',
      provider: 'opennode',
      providerWithdrawalId: 'wWebhookIdMeta',
      status: 'SUBMITTED',
      amountMsat: '123',
      purchaseId: 'buyWebhookIdMeta',
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

    const res = await app.inject({
      method: 'POST',
      url: '/webhooks/opennode/withdrawals',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      payload: new URLSearchParams({
        id: '  wWebhookIdMeta  ',
        status: 'failed',
        fee: '1',
        hashed_order: hmacHex(apiKey, 'wWebhookIdMeta'),
      } as any).toString(),
    });

    expect(res.statusCode).toBe(200);
    const updateArg = (prismaMock.payout.update as any).mock.calls[0][0];
    expect(updateArg.data.providerMetaJson.webhook.id).toBe('wWebhookIdMeta');
    expect(updateArg.data.providerMetaJson.webhook.id_raw).toBe('wWebhookIdMeta');
    expect(updateArg.data.providerMetaJson.webhook.id_length).toBe(14);
    expect(updateArg.data.providerMetaJson.webhook.id_truncated).toBe(false);
    expect(updateArg.data.providerMetaJson.webhook.id_had_surrounding_whitespace).toBe(true);
  });

  it('truncates oversized webhook id metadata without affecting signature verification', async () => {
    const longId = `w-${'x'.repeat(200)}`;
    const payout: Payout = {
      id: 'pWebhookIdLong',
      provider: 'opennode',
      providerWithdrawalId: longId,
      status: 'SUBMITTED',
      amountMsat: '123',
      purchaseId: 'buyWebhookIdLong',
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

    const logs: string[] = [];
    const app = makeAppWithLogCapture(logs);
    await registerOpenNodeWebhookRoutes(app);

    const res = await app.inject({
      method: 'POST',
      url: '/webhooks/opennode/withdrawals',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      payload: new URLSearchParams({
        id: longId,
        status: 'failed',
        fee: '1',
        hashed_order: hmacHex(apiKey, longId),
      } as any).toString(),
    });

    expect(res.statusCode).toBe(200);
    const updateArg = (prismaMock.payout.update as any).mock.calls[0][0];
    expect(updateArg.data.providerMetaJson.webhook.id).toHaveLength(128);
    expect(updateArg.data.providerMetaJson.webhook.id_raw).toBe(longId);
    expect(updateArg.data.providerMetaJson.webhook.id_length).toBe(longId.length);
    expect(updateArg.data.providerMetaJson.webhook.id_truncated).toBe(true);
    expect(updateArg.data.providerMetaJson.webhook.id_had_surrounding_whitespace).toBe(false);

    const warnLog = parseLogEntries(logs).find((entry) => entry.msg === 'opennode withdrawals webhook: id shape anomaly observed');
    expect(warnLog).toBeTruthy();
    expect(warnLog?.idShapeAnomaly).toMatchObject({
      withdrawal_id_present: true,
      withdrawal_id_length: 202,
      id_length: 202,
      id_truncated: true,
    });
  });

  it('records providerWithdrawalId match audit metadata when payout lookup id matches exactly', async () => {
    const payout: Payout = {
      id: 'pProviderIdExact',
      provider: 'opennode',
      providerWithdrawalId: 'wProviderIdExact',
      status: 'SUBMITTED',
      amountMsat: '123',
      purchaseId: 'buyProviderIdExact',
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

    const res = await app.inject({
      method: 'POST',
      url: '/webhooks/opennode/withdrawals',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      payload: new URLSearchParams({
        id: 'wProviderIdExact',
        status: 'failed',
        fee: '1',
        hashed_order: hmacHex(apiKey, 'wProviderIdExact'),
      } as any).toString(),
    });

    expect(res.statusCode).toBe(200);
    const updateArg = (prismaMock.payout.update as any).mock.calls[0][0];
    expect(updateArg.data.providerMetaJson.webhook.provider_withdrawal_id).toBe('wProviderIdExact');
    expect(updateArg.data.providerMetaJson.webhook.provider_withdrawal_id_length).toBe(16);
    expect(updateArg.data.providerMetaJson.webhook.provider_withdrawal_id_matches).toBe(true);
    expect(updateArg.data.providerMetaJson.webhook.provider_withdrawal_id_casefold_matches).toBe(true);
  });

  it('records providerWithdrawalId casefold mismatch metadata non-blockingly', async () => {
    const payout: Payout = {
      id: 'pProviderIdCasefold',
      provider: 'opennode',
      providerWithdrawalId: 'WPROVIDERIDCASEFOLD',
      status: 'SUBMITTED',
      amountMsat: '123',
      purchaseId: 'buyProviderIdCasefold',
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

    const res = await app.inject({
      method: 'POST',
      url: '/webhooks/opennode/withdrawals',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      payload: new URLSearchParams({
        id: 'wprovideridcasefold',
        status: 'failed',
        fee: '1',
        hashed_order: hmacHex(apiKey, 'wprovideridcasefold'),
      } as any).toString(),
    });

    expect(res.statusCode).toBe(200);
    const updateArg = (prismaMock.payout.update as any).mock.calls[0][0];
    expect(updateArg.data.providerMetaJson.webhook.provider_withdrawal_id).toBe('WPROVIDERIDCASEFOLD');
    expect(updateArg.data.providerMetaJson.webhook.provider_withdrawal_id_matches).toBe(false);
    expect(updateArg.data.providerMetaJson.webhook.provider_withdrawal_id_casefold_matches).toBe(true);
  });


  it('logs failure fee-equals-amount anomaly non-blockingly', async () => {
    const payout: Payout = {
      id: 'pFailureFeeEqualsAmount',
      provider: 'opennode',
      providerWithdrawalId: 'wFailureFeeEqualsAmount',
      status: 'SUBMITTED',
      amountMsat: '123',
      purchaseId: 'buyFailureFeeEqualsAmount',
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

    const logs: string[] = [];
    const app = makeAppWithLogCapture(logs);
    await registerOpenNodeWebhookRoutes(app);

    const res = await app.inject({
      method: 'POST',
      url: '/webhooks/opennode/withdrawals',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      payload: new URLSearchParams({
        id: 'wFailureFeeEqualsAmount',
        status: 'failed',
        amount: '42',
        fee: '42',
        error: 'provider failed settlement',
        processed_at: '2026-02-08T04:25:00Z',
        hashed_order: hmacHex(apiKey, 'wFailureFeeEqualsAmount'),
      } as any).toString(),
    });

    expect(res.statusCode).toBe(200);

    const warnLog = parseLogEntries(logs).find((entry) => entry.msg === 'opennode withdrawals webhook: failure fee equals amount');
    expect(warnLog).toBeTruthy();
    expect(warnLog?.failureFeeEqualsAmount).toMatchObject({
      withdrawal_id_present: true,
      withdrawal_id_length: 23,
      status: 'failed',
      status_raw: 'failed',
      amount_valid: true,
      amount_number: 42,
      fee_valid: true,
      fee_number: 42,
      fee_equal_amount: true,
    });
  });


  it('logs failure fee-greater-than-amount anomaly non-blockingly', async () => {
    const payout: Payout = {
      id: 'pFailureFeeGreaterThanAmount',
      provider: 'opennode',
      providerWithdrawalId: 'wFailureFeeGreaterThanAmount',
      status: 'SUBMITTED',
      amountMsat: '123',
      purchaseId: 'buyFailureFeeGreaterThanAmount',
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

    const logs: string[] = [];
    const app = makeAppWithLogCapture(logs);
    await registerOpenNodeWebhookRoutes(app);

    const res = await app.inject({
      method: 'POST',
      url: '/webhooks/opennode/withdrawals',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      payload: new URLSearchParams({
        id: 'wFailureFeeGreaterThanAmount',
        status: 'failed',
        amount: '21',
        fee: '42',
        error: 'provider failed settlement',
        processed_at: '2026-02-08T04:30:00Z',
        hashed_order: hmacHex(apiKey, 'wFailureFeeGreaterThanAmount'),
      } as any).toString(),
    });

    expect(res.statusCode).toBe(200);

    const warnLog = parseLogEntries(logs).find((entry) => entry.msg === 'opennode withdrawals webhook: failure fee greater than amount');
    expect(warnLog).toBeTruthy();
    expect(warnLog?.failureFeeGreaterThanAmount).toMatchObject({
      withdrawal_id_present: true,
      withdrawal_id_length: 28,
      status: 'failed',
      status_raw: 'failed',
      amount_valid: true,
      amount_number: 21,
      fee_valid: true,
      fee_number: 42,
      fee_greater_than_amount: true,
    });
  });

  it('logs failure zero-amount anomaly non-blockingly', async () => {
    const payout: Payout = {
      id: 'pFailureZeroAmount',
      provider: 'opennode',
      providerWithdrawalId: 'wFailureZeroAmount',
      status: 'SUBMITTED',
      amountMsat: '123',
      purchaseId: 'buyFailureZeroAmount',
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

    const logs: string[] = [];
    const app = makeAppWithLogCapture(logs);
    await registerOpenNodeWebhookRoutes(app);

    const res = await app.inject({
      method: 'POST',
      url: '/webhooks/opennode/withdrawals',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      payload: new URLSearchParams({
        id: 'wFailureZeroAmount',
        status: 'failed',
        amount: '0',
        fee: '0',
        error: 'provider marked failed',
        processed_at: '2026-02-08T04:35:00Z',
        hashed_order: hmacHex(apiKey, 'wFailureZeroAmount'),
      } as any).toString(),
    });

    expect(res.statusCode).toBe(200);

    const warnLog = parseLogEntries(logs).find((entry) => entry.msg === 'opennode withdrawals webhook: failure amount is zero');
    expect(warnLog).toBeTruthy();
    expect(warnLog?.failureZeroAmount).toMatchObject({
      withdrawal_id_present: true,
      withdrawal_id_length: 18,
      status: 'failed',
      status_raw: 'failed',
      amount_valid: true,
      amount_number: 0,
      fee_valid: true,
      fee_number: 0,
      amount_zero: true,
    });
  });


  it('logs failure zero-fee anomaly non-blockingly', async () => {
    const payout: Payout = {
      id: 'pFailureZeroFee',
      provider: 'opennode',
      providerWithdrawalId: 'wFailureZeroFee',
      status: 'SUBMITTED',
      amountMsat: '123',
      purchaseId: 'buyFailureZeroFee',
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

    const logs: string[] = [];
    const app = makeAppWithLogCapture(logs);
    await registerOpenNodeWebhookRoutes(app);

    const res = await app.inject({
      method: 'POST',
      url: '/webhooks/opennode/withdrawals',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      payload: new URLSearchParams({
        id: 'wFailureZeroFee',
        status: 'failed',
        amount: '100',
        fee: '0',
        error: 'provider failed settlement',
        processed_at: '2026-02-08T05:05:00Z',
        hashed_order: hmacHex(apiKey, 'wFailureZeroFee'),
      } as any).toString(),
    });

    expect(res.statusCode).toBe(200);

    const parsedLogs = parseLogEntries(logs);
    const warnLog = parsedLogs.find((entry) => entry.msg === 'opennode withdrawals webhook: failure fee is zero');
    expect(warnLog).toBeTruthy();
    expect(warnLog?.failureZeroFee).toMatchObject({
      withdrawal_id_present: true,
      withdrawal_id_length: 15,
      status: 'failed',
      status_raw: 'failed',
      amount_valid: true,
      amount_number: 100,
      fee_valid: true,
      fee_number: 0,
      fee_zero: true,
    });

    const misclassifiedWarn = parsedLogs.find((entry) => entry.msg === 'opennode withdrawals webhook: confirmed fee is zero');
    expect(misclassifiedWarn).toBeUndefined();
  });

  it('logs numeric parse anomalies non-blockingly', async () => {
    const payout: Payout = {
      id: 'pNumericParseAnomaly',
      provider: 'opennode',
      providerWithdrawalId: 'wNumericParseAnomaly',
      status: 'SUBMITTED',
      amountMsat: '123',
      purchaseId: 'buyNumericParseAnomaly',
      providerMetaJson: {},
    };

    const prismaMock = {
      payout: {
        findFirst: vi.fn(async () => ({ ...payout })),
        update: vi.fn(async () => ({ ...payout, status: 'SENT' })),
        findUnique: vi.fn(async () => ({ ...payout })),
      },
      ledgerEntry: {
        findFirst: vi.fn(async () => null),
        create: vi.fn(async () => ({ id: 'leNumericParseAnomaly' })),
      },
      $transaction: vi.fn(async (fn: any) =>
        fn({
          payout: prismaMock.payout,
          ledgerEntry: prismaMock.ledgerEntry,
        }),
      ),
    };

    vi.doMock('../prisma.js', () => ({ prisma: prismaMock }));
    const { registerOpenNodeWebhookRoutes } = await import('./opennodeWebhooks.js');

    const logs: string[] = [];
    const app = makeAppWithLogCapture(logs);
    await registerOpenNodeWebhookRoutes(app);

    const res = await app.inject({
      method: 'POST',
      url: '/webhooks/opennode/withdrawals',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      payload: new URLSearchParams({
        id: 'wNumericParseAnomaly',
        status: 'confirmed',
        amount: 'not-a-number',
        fee: '1',
        processed_at: '2026-02-08T05:05:00Z',
        hashed_order: hmacHex(apiKey, 'wNumericParseAnomaly'),
      } as any).toString(),
    });

    expect(res.statusCode).toBe(200);

    const warnLog = parseLogEntries(logs).find((entry) => entry.msg === 'opennode withdrawals webhook: numeric parse anomaly observed');
    expect(warnLog).toBeTruthy();
    expect(warnLog?.numericParseAnomaly).toMatchObject({
      withdrawal_id_present: true,
      withdrawal_id_length: 20,
      amount_raw: 'not-a-number',
      amount_valid: false,
      fee_raw: '1',
      fee_valid: true,
    });
  });


  it('logs numeric shape anomaly for scientific-notation and leading-plus inputs non-blockingly', async () => {
    const payout: Payout = {
      id: 'pNumericShapeAnomaly',
      provider: 'opennode',
      providerWithdrawalId: 'wNumericShapeAnomaly',
      status: 'SUBMITTED',
      amountMsat: '123',
      purchaseId: 'buyNumericShapeAnomaly',
      providerMetaJson: {},
    };

    const prismaMock = {
      payout: {
        findFirst: vi.fn(async () => ({ ...payout })),
        update: vi.fn(async () => ({ ...payout, status: 'SENT' })),
        findUnique: vi.fn(async () => ({ ...payout })),
      },
      ledgerEntry: {
        findFirst: vi.fn(async () => null),
        create: vi.fn(async () => ({ id: 'leNumericShapeAnomaly' })),
      },
      $transaction: vi.fn(async (fn: any) =>
        fn({
          payout: prismaMock.payout,
          ledgerEntry: prismaMock.ledgerEntry,
        }),
      ),
    };

    vi.doMock('../prisma.js', () => ({ prisma: prismaMock }));
    const { registerOpenNodeWebhookRoutes } = await import('./opennodeWebhooks.js');

    const logs: string[] = [];
    const app = makeAppWithLogCapture(logs);
    await registerOpenNodeWebhookRoutes(app);

    const res = await app.inject({
      method: 'POST',
      url: '/webhooks/opennode/withdrawals',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      payload: new URLSearchParams({
        id: 'wNumericShapeAnomaly',
        status: 'confirmed',
        amount: '1e2',
        fee: '+1',
        processed_at: '2026-02-08T05:05:00Z',
        hashed_order: hmacHex(apiKey, 'wNumericShapeAnomaly'),
      } as any).toString(),
    });

    expect(res.statusCode).toBe(200);

    const warnLog = parseLogEntries(logs).find((entry) => entry.msg === 'opennode withdrawals webhook: numeric shape anomaly observed');
    expect(warnLog).toBeTruthy();
    expect(warnLog?.numericShapeAnomaly).toMatchObject({
      withdrawal_id_present: true,
      withdrawal_id_length: 20,
      amount_raw: '1e2',
      amount_uses_scientific_notation: true,
      amount_has_leading_plus: false,
      fee_raw: '+1',
      fee_uses_scientific_notation: false,
      fee_has_leading_plus: true,
    });
  });


  it('logs numeric precision anomaly when decimal places exceed 8 non-blockingly', async () => {
    const payout: Payout = {
      id: 'pNumericPrecisionAnomaly',
      provider: 'opennode',
      providerWithdrawalId: 'wNumericPrecisionAnomaly',
      status: 'SUBMITTED',
      amountMsat: '123',
      purchaseId: 'buyNumericPrecisionAnomaly',
      providerMetaJson: {},
    };

    const prismaMock = {
      payout: {
        findFirst: vi.fn(async () => ({ ...payout })),
        update: vi.fn(async () => ({ ...payout, status: 'SENT' })),
        findUnique: vi.fn(async () => ({ ...payout })),
      },
      ledgerEntry: {
        findFirst: vi.fn(async () => null),
        create: vi.fn(async () => ({ id: 'leNumericPrecisionAnomaly' })),
      },
      $transaction: vi.fn(async (fn: any) =>
        fn({
          payout: prismaMock.payout,
          ledgerEntry: prismaMock.ledgerEntry,
        }),
      ),
    };

    vi.doMock('../prisma.js', () => ({ prisma: prismaMock }));
    const { registerOpenNodeWebhookRoutes } = await import('./opennodeWebhooks.js');

    const logs: string[] = [];
    const app = makeAppWithLogCapture(logs);
    await registerOpenNodeWebhookRoutes(app);

    const res = await app.inject({
      method: 'POST',
      url: '/webhooks/opennode/withdrawals',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      payload: new URLSearchParams({
        id: 'wNumericPrecisionAnomaly',
        status: 'confirmed',
        amount: '0.123456789',
        fee: '0.000000001',
        processed_at: '2026-02-08T05:05:00Z',
        hashed_order: hmacHex(apiKey, 'wNumericPrecisionAnomaly'),
      } as any).toString(),
    });

    expect(res.statusCode).toBe(200);

    const warnLog = parseLogEntries(logs).find((entry) => entry.msg === 'opennode withdrawals webhook: numeric precision anomaly observed');
    expect(warnLog).toBeTruthy();
    expect(warnLog?.numericPrecisionAnomaly).toMatchObject({
      withdrawal_id_present: true,
      withdrawal_id_length: 24,
      amount_raw: '0.123456789',
      amount_decimal_places: 9,
      fee_raw: '0.000000001',
      fee_decimal_places: 9,
      max_decimal_places: 8,
    });
  });


  it('logs numeric grouping anomaly when amount/fee include separators non-blockingly', async () => {
    const payout: Payout = {
      id: 'pNumericGroupingAnomaly',
      provider: 'opennode',
      providerWithdrawalId: 'wNumericGroupingAnomaly',
      status: 'SUBMITTED',
      amountMsat: '123',
      purchaseId: 'buyNumericGroupingAnomaly',
      providerMetaJson: {},
    };

    const prismaMock = {
      payout: {
        findFirst: vi.fn(async () => ({ ...payout })),
        update: vi.fn(async () => ({ ...payout, status: 'SENT' })),
        findUnique: vi.fn(async () => ({ ...payout })),
      },
      ledgerEntry: {
        findFirst: vi.fn(async () => null),
        create: vi.fn(async () => ({ id: 'leNumericGroupingAnomaly' })),
      },
      $transaction: vi.fn(async (fn: any) =>
        fn({
          payout: prismaMock.payout,
          ledgerEntry: prismaMock.ledgerEntry,
        }),
      ),
    };

    vi.doMock('../prisma.js', () => ({ prisma: prismaMock }));
    const { registerOpenNodeWebhookRoutes } = await import('./opennodeWebhooks.js');

    const logs: string[] = [];
    const app = makeAppWithLogCapture(logs);
    await registerOpenNodeWebhookRoutes(app);

    const res = await app.inject({
      method: 'POST',
      url: '/webhooks/opennode/withdrawals',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      payload: new URLSearchParams({
        id: 'wNumericGroupingAnomaly',
        status: 'confirmed',
        amount: '1,000',
        fee: '2_5',
        processed_at: '2026-02-08T05:05:00Z',
        hashed_order: hmacHex(apiKey, 'wNumericGroupingAnomaly'),
      } as any).toString(),
    });

    expect(res.statusCode).toBe(200);

    const warnLog = parseLogEntries(logs).find((entry) => entry.msg === 'opennode withdrawals webhook: numeric grouping anomaly observed');
    expect(warnLog).toBeTruthy();
    expect(warnLog?.numericGroupingAnomaly).toMatchObject({
      withdrawal_id_present: true,
      withdrawal_id_length: 23,
      amount_raw: '1,000',
      amount_has_grouping_separators: true,
      fee_raw: '2_5',
      fee_has_grouping_separators: true,
    });
  });


  it('logs numeric safe-integer anomaly for oversized numeric fields non-blockingly', async () => {
    const payout: Payout = {
      id: 'pNumericSafeIntegerAnomaly',
      provider: 'opennode',
      providerWithdrawalId: 'wNumericSafeIntegerAnomaly',
      status: 'SUBMITTED',
      amountMsat: '123',
      purchaseId: 'buyNumericSafeIntegerAnomaly',
      providerMetaJson: {},
    };

    const prismaMock = {
      payout: {
        findFirst: vi.fn(async () => ({ ...payout })),
        update: vi.fn(async () => ({ ...payout, status: 'SENT' })),
        findUnique: vi.fn(async () => ({ ...payout })),
      },
      ledgerEntry: {
        findFirst: vi.fn(async () => null),
        create: vi.fn(async () => ({ id: 'leNumericSafeIntegerAnomaly' })),
      },
      $transaction: vi.fn(async (fn: any) =>
        fn({
          payout: prismaMock.payout,
          ledgerEntry: prismaMock.ledgerEntry,
        }),
      ),
    };

    vi.doMock('../prisma.js', () => ({ prisma: prismaMock }));
    const { registerOpenNodeWebhookRoutes } = await import('./opennodeWebhooks.js');

    const logs: string[] = [];
    const app = makeAppWithLogCapture(logs);
    await registerOpenNodeWebhookRoutes(app);

    const res = await app.inject({
      method: 'POST',
      url: '/webhooks/opennode/withdrawals',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      payload: new URLSearchParams({
        id: 'wNumericSafeIntegerAnomaly',
        status: 'confirmed',
        amount: '9007199254740993',
        fee: '9007199254740994',
        processed_at: '2026-02-08T05:05:00Z',
        hashed_order: hmacHex(apiKey, 'wNumericSafeIntegerAnomaly'),
      } as any).toString(),
    });

    expect(res.statusCode).toBe(200);

    const warnLog = parseLogEntries(logs).find((entry) => entry.msg === 'opennode withdrawals webhook: numeric safe-integer anomaly observed');
    expect(warnLog).toBeTruthy();
    expect(warnLog?.numericSafeIntegerAnomaly).toMatchObject({
      withdrawal_id_present: true,
      withdrawal_id_length: 26,
      amount_raw: '9007199254740993',
      amount_valid: true,
      amount_unsafe_integer: true,
      fee_raw: '9007199254740994',
      fee_valid: true,
      fee_unsafe_integer: true,
    });
  });

  it('logs failure negative-amount anomaly non-blockingly', async () => {
    const payout: Payout = {
      id: 'pFailureNegativeAmount',
      provider: 'opennode',
      providerWithdrawalId: 'wFailureNegativeAmount',
      status: 'SUBMITTED',
      amountMsat: '123',
      purchaseId: 'buyFailureNegativeAmount',
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

    const logs: string[] = [];
    const app = makeAppWithLogCapture(logs);
    await registerOpenNodeWebhookRoutes(app);

    const res = await app.inject({
      method: 'POST',
      url: '/webhooks/opennode/withdrawals',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      payload: new URLSearchParams({
        id: 'wFailureNegativeAmount',
        status: 'failed',
        amount: '-1',
        fee: '0',
        error: 'provider failed settlement',
        processed_at: '2026-02-08T04:40:00Z',
        hashed_order: hmacHex(apiKey, 'wFailureNegativeAmount'),
      } as any).toString(),
    });

    expect(res.statusCode).toBe(200);

    const warnLog = parseLogEntries(logs).find((entry) => entry.msg === 'opennode withdrawals webhook: failure amount is negative');
    expect(warnLog).toBeTruthy();
    expect(warnLog?.failureNegativeAmount).toMatchObject({
      withdrawal_id_present: true,
      withdrawal_id_length: 22,
      status: 'failed',
      status_raw: 'failed',
      amount_valid: true,
      amount_number: -1,
      fee_valid: true,
      fee_number: 0,
      amount_negative: true,
    });
  });

  it('logs failure negative-fee anomaly non-blockingly', async () => {
    const payout: Payout = {
      id: 'pFailureNegativeFee',
      provider: 'opennode',
      providerWithdrawalId: 'wFailureNegativeFee',
      status: 'SUBMITTED',
      amountMsat: '123',
      purchaseId: 'buyFailureNegativeFee',
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

    const logs: string[] = [];
    const app = makeAppWithLogCapture(logs);
    await registerOpenNodeWebhookRoutes(app);

    const res = await app.inject({
      method: 'POST',
      url: '/webhooks/opennode/withdrawals',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      payload: new URLSearchParams({
        id: 'wFailureNegativeFee',
        status: 'failed',
        amount: '100',
        fee: '-1',
        error: 'provider failed settlement',
        processed_at: '2026-02-08T04:45:00Z',
        hashed_order: hmacHex(apiKey, 'wFailureNegativeFee'),
      } as any).toString(),
    });

    expect(res.statusCode).toBe(200);

    const warnLog = parseLogEntries(logs).find((entry) => entry.msg === 'opennode withdrawals webhook: failure fee is negative');
    expect(warnLog).toBeTruthy();
    expect(warnLog?.failureNegativeFee).toMatchObject({
      withdrawal_id_present: true,
      withdrawal_id_length: 19,
      status: 'failed',
      status_raw: 'failed',
      amount_valid: true,
      amount_number: 100,
      fee_valid: true,
      fee_number: -1,
      fee_negative: true,
    });
  });

  it('logs failure timing anomaly when failed webhook omits processed_at', async () => {
    const payout: Payout = {
      id: 'pFailureTiming',
      provider: 'opennode',
      providerWithdrawalId: 'wFailureTiming',
      status: 'SUBMITTED',
      amountMsat: '123',
      purchaseId: 'buyFailureTiming',
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

    const logs: string[] = [];
    const app = makeAppWithLogCapture(logs);
    await registerOpenNodeWebhookRoutes(app);

    const res = await app.inject({
      method: 'POST',
      url: '/webhooks/opennode/withdrawals',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      payload: new URLSearchParams({
        id: 'wFailureTiming',
        status: 'failed',
        fee: '1',
        hashed_order: hmacHex(apiKey, 'wFailureTiming'),
      } as any).toString(),
    });

    expect(res.statusCode).toBe(200);

    const warnLog = parseLogEntries(logs).find((entry) => entry.msg === 'opennode withdrawals webhook: failure status missing/invalid processed_at');
    expect(warnLog).toBeTruthy();
    expect(warnLog?.failureTimingAnomaly).toMatchObject({
      withdrawal_id_present: true,
      withdrawal_id_length: 14,
      status: 'failed',
      status_raw: 'failed',
      processed_at: null,
      processed_at_iso: null,
      processed_at_valid: false,
    });
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
    expect(updateArg.data.providerMetaJson.webhook.error_present).toBe(false);
    expect(updateArg.data.providerMetaJson.webhook.error_missing_for_failure).toBe(true);
    expect(updateArg.data.providerMetaJson.webhook.error_present_on_confirmed).toBe(false);
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

    const logs: string[] = [];
    const app = makeAppWithLogCapture(logs);
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

    const warnLog = parseLogEntries(logs).find((entry) => entry.msg === 'opennode withdrawals webhook: error payload truncated');
    expect(warnLog).toBeTruthy();
    expect(warnLog?.errorTruncation).toMatchObject({
      withdrawal_id_present: true,
      withdrawal_id_length: 10,
      status: 'failed',
      status_raw: 'failed',
      error_truncated: true,
    });
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

    const logs: string[] = [];
    const app = makeAppWithLogCapture(logs);
    await registerOpenNodeWebhookRoutes(app);

    const body = {
      id: 'w3',
      status: 'weird_new_status',
      type: 'withdrawal',
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
    expect(updateArg.data.providerMetaJson.webhook.status).toBe('weird_new_status');
    expect(updateArg.data.providerMetaJson.webhook.status_raw).toBe('weird_new_status');
    expect(updateArg.data.providerMetaJson.webhook.status_known).toBe(false);
    expect(updateArg.data.providerMetaJson.webhook.status_kind).toBe('unknown');
    expect(updateArg.data.providerMetaJson.webhook.status_had_surrounding_whitespace).toBe(false);

    const warnLog = parseLogEntries(logs).find((entry) => entry.msg === 'opennode withdrawals webhook: unknown status acked');
    expect(warnLog).toBeTruthy();
    expect(warnLog?.route).toBe('opennode.withdrawals');
    expect(warnLog?.unknownStatus).toMatchObject({
      withdrawal_id_present: true,
      withdrawal_id_length: 2,
      status: 'weird_new_status',
      status_raw: 'weird_new_status',
      status_known: false,
      type: 'withdrawal',
      type_known: true,
    });

    const mismatchLog = parseLogEntries(logs).find((entry) => entry.msg === 'opennode withdrawals webhook: unknown status on withdrawal type observed');
    expect(mismatchLog).toBeTruthy();
    expect(mismatchLog?.unknownWithdrawalStatus).toMatchObject({
      withdrawal_id_present: true,
      withdrawal_id_length: 2,
      status: 'weird_new_status',
      status_raw: 'weird_new_status',
      status_known: false,
      type: 'withdrawal',
      type_known: true,
    });
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
