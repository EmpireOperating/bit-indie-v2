import fastify from 'fastify';
import { beforeEach, describe, expect, it, vi } from 'vitest';

function makeApp() {
  return fastify({ logger: false });
}

function paidPurchaseFixture(overrides: Record<string, unknown> = {}) {
  return {
    id: 'purchase-1',
    invoiceId: 'mock_invoice_1',
    status: 'PAID',
    paidAt: new Date('2026-02-07T12:00:00.000Z'),
    amountMsat: 10_000n,
    buyerUserId: 'buyer-1',
    guestReceiptCode: null,
    gameId: 'game-1',
    game: { developerUserId: 'dev-1' },
    entitlement: null,
    ...overrides,
  };
}

describe('purchase claim route normalization', () => {
  beforeEach(() => {
    vi.resetModules();
    delete process.env.MOCK_WEBHOOK_SECRET;
  });

  it('normalizes receiptCode by trimming + uppercasing before lookup', async () => {
    const tx = {
      purchase: {
        findUnique: vi.fn(async () => null),
      },
      user: {
        upsert: vi.fn(async () => ({ id: 'buyer-1' })),
      },
      entitlement: {
        update: vi.fn(async () => ({ id: 'ent-1' })),
        create: vi.fn(async () => ({ id: 'ent-1' })),
      },
    };

    const prismaMock = {
      $transaction: vi.fn(async (fn: any) => fn(tx)),
    };

    vi.doMock('../prisma.js', () => ({ prisma: prismaMock }));
    const { registerPurchaseRoutes } = await import('./purchases.js');

    const app = makeApp();
    await registerPurchaseRoutes(app);

    const res = await app.inject({
      method: 'POST',
      url: '/purchases/claim',
      payload: { receiptCode: '  ab-123-cd  ', buyerPubkey: 'a'.repeat(64) },
    });

    expect(res.statusCode).toBe(404);
    expect(tx.purchase.findUnique).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { guestReceiptCode: 'AB-123-CD' },
      }),
    );

    await app.close();
  });
});

describe('purchase create route amount validation', () => {
  beforeEach(() => {
    vi.resetModules();
    delete process.env.MOCK_WEBHOOK_SECRET;
  });

  it('rejects unsafe number values for amountMsat', async () => {
    const tx = {
      game: {
        findUnique: vi.fn(async () => ({ id: 'game-1' })),
      },
      user: {
        upsert: vi.fn(async () => ({ id: 'buyer-1' })),
      },
      purchase: {
        create: vi.fn(async () => ({ id: 'purchase-1' })),
      },
      ledgerEntry: {
        create: vi.fn(async () => ({ id: 'ledger-1' })),
      },
    };

    const prismaMock = {
      $transaction: vi.fn(async (fn: any) => fn(tx)),
    };

    vi.doMock('../prisma.js', () => ({ prisma: prismaMock }));
    const { registerPurchaseRoutes } = await import('./purchases.js');

    const app = makeApp();
    await registerPurchaseRoutes(app);

    const res = await app.inject({
      method: 'POST',
      url: '/purchases',
      payload: {
        gameId: '11111111-1111-4111-8111-111111111111',
        amountMsat: Number.MAX_SAFE_INTEGER + 1,
      },
    });

    expect(res.statusCode).toBe(400);
    expect(res.json().error).toContain('safe integer');
    expect(prismaMock.$transaction).not.toHaveBeenCalled();

    await app.close();
  });
});

describe('purchase mock paid webhook idempotency', () => {
  beforeEach(() => {
    vi.resetModules();
    delete process.env.MOCK_WEBHOOK_SECRET;
  });

  it('returns 401 with consistent envelope when mock webhook secret mismatches', async () => {
    process.env.MOCK_WEBHOOK_SECRET = 'expected-secret';

    const prismaMock = {
      $transaction: vi.fn(async () => {
        throw new Error('should not run transaction on unauthorized webhook');
      }),
    };

    vi.doMock('../prisma.js', () => ({ prisma: prismaMock }));
    const { registerPurchaseRoutes } = await import('./purchases.js');

    const app = makeApp();
    await registerPurchaseRoutes(app);

    const res = await app.inject({
      method: 'POST',
      url: '/webhooks/mock/invoice-paid',
      headers: { 'x-mock-webhook-secret': 'wrong-secret' },
      payload: { invoiceId: 'mock_invoice_1' },
    });

    expect(res.statusCode).toBe(401);
    expect(res.json()).toEqual({ ok: false, error: 'Unauthorized' });
    expect(prismaMock.$transaction).not.toHaveBeenCalled();

    await app.close();
  });

  it.each([
    {
      name: 'rebuilds all missing artifacts',
      existingLedgerTypes: [],
      expectedCreatedLedgerTypes: ['INVOICE_PAID', 'PLATFORM_FEE', 'DEVELOPER_NET'],
    },
    {
      name: 'repairs missing INVOICE_PAID only',
      existingLedgerTypes: ['PLATFORM_FEE', 'DEVELOPER_NET'],
      expectedCreatedLedgerTypes: ['INVOICE_PAID'],
    },
    {
      name: 'repairs missing PLATFORM_FEE only',
      existingLedgerTypes: ['INVOICE_PAID', 'DEVELOPER_NET'],
      expectedCreatedLedgerTypes: ['PLATFORM_FEE'],
    },
    {
      name: 'repairs missing DEVELOPER_NET only',
      existingLedgerTypes: ['INVOICE_PAID', 'PLATFORM_FEE'],
      expectedCreatedLedgerTypes: ['DEVELOPER_NET'],
    },
    {
      name: 'repairs missing payout only',
      existingLedgerTypes: ['INVOICE_PAID', 'PLATFORM_FEE', 'DEVELOPER_NET'],
      expectedCreatedLedgerTypes: [],
    },
  ])('$name', async ({ existingLedgerTypes, expectedCreatedLedgerTypes }) => {
    const purchase = paidPurchaseFixture();

    const tx = {
      purchase: {
        findUnique: vi.fn(async () => ({ ...purchase })),
        update: vi.fn(async () => {
          throw new Error('should not update purchase status when already PAID');
        }),
      },
      developerProfile: {
        findUnique: vi.fn(async () => ({ userId: 'dev-1', payoutLnAddress: 'dev@getalby.com' })),
      },
      entitlement: {
        upsert: vi.fn(async () => ({ id: 'ent-1' })),
      },
      ledgerEntry: {
        findMany: vi.fn(async () => existingLedgerTypes.map((type) => ({ type }))),
        create: vi.fn(async ({ data }) => ({ id: `le-${data.type}` })),
      },
      payout: {
        upsert: vi.fn(async () => ({ id: 'payout-1' })),
      },
    };

    const prismaMock = {
      $transaction: vi.fn(async (fn: any) => fn(tx)),
    };

    vi.doMock('../prisma.js', () => ({ prisma: prismaMock }));
    const { registerPurchaseRoutes } = await import('./purchases.js');

    const app = makeApp();
    await registerPurchaseRoutes(app);

    const res = await app.inject({
      method: 'POST',
      url: '/webhooks/mock/invoice-paid',
      payload: { invoiceId: 'mock_invoice_1' },
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.ok).toBe(true);
    expect(body.already).toBe(true);
    expect(body.repaired).toBe(true);

    expect(tx.entitlement.upsert).toHaveBeenCalledTimes(1);
    expect(tx.payout.upsert).toHaveBeenCalledTimes(1);

    const createdTypes = (tx.ledgerEntry.create as any).mock.calls.map((c: any[]) => c[0].data.type);
    expect(createdTypes).toEqual(expectedCreatedLedgerTypes);

    await app.close();
  });

  it('returns 409 for PAID replay when developer payout profile is missing', async () => {
    const purchase = paidPurchaseFixture({
      id: 'purchase-2',
      invoiceId: 'mock_invoice_2',
      game: { developerUserId: 'dev-missing' },
    });

    const tx = {
      purchase: {
        findUnique: vi.fn(async () => ({ ...purchase })),
      },
      developerProfile: {
        findUnique: vi.fn(async () => null),
      },
      entitlement: {
        upsert: vi.fn(async () => ({ id: 'ent-1' })),
      },
      ledgerEntry: {
        findMany: vi.fn(async () => []),
        create: vi.fn(async () => ({ id: 'le-1' })),
      },
      payout: {
        upsert: vi.fn(async () => ({ id: 'payout-1' })),
      },
    };

    const prismaMock = {
      $transaction: vi.fn(async (fn: any) => fn(tx)),
    };

    vi.doMock('../prisma.js', () => ({ prisma: prismaMock }));
    const { registerPurchaseRoutes } = await import('./purchases.js');

    const app = makeApp();
    await registerPurchaseRoutes(app);

    const res = await app.inject({
      method: 'POST',
      url: '/webhooks/mock/invoice-paid',
      payload: { invoiceId: 'mock_invoice_2' },
    });

    expect(res.statusCode).toBe(409);
    const body = res.json();
    expect(body.error).toContain('Developer profile missing');

    expect(tx.entitlement.upsert).not.toHaveBeenCalled();
    expect(tx.payout.upsert).not.toHaveBeenCalled();

    await app.close();
  });
});
