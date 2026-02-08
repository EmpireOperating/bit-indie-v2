import fastify from 'fastify';
import { beforeEach, describe, expect, it, vi } from 'vitest';

function makeApp() {
  return fastify({ logger: false });
}

describe('purchase mock paid webhook idempotency', () => {
  beforeEach(() => {
    vi.resetModules();
    delete process.env.MOCK_WEBHOOK_SECRET;
  });

  it('replays PAID webhook as idempotent repair and re-schedules payout artifacts', async () => {
    const purchase = {
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
    };

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
      payload: { invoiceId: 'mock_invoice_1' },
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.ok).toBe(true);
    expect(body.already).toBe(true);
    expect(body.repaired).toBe(true);

    expect(tx.entitlement.upsert).toHaveBeenCalledTimes(1);
    expect(tx.ledgerEntry.create).toHaveBeenCalledTimes(3);
    expect(tx.payout.upsert).toHaveBeenCalledTimes(1);

    await app.close();
  });

  it('returns 409 for PAID replay when developer payout profile is missing', async () => {
    const purchase = {
      id: 'purchase-2',
      invoiceId: 'mock_invoice_2',
      status: 'PAID',
      paidAt: new Date('2026-02-07T12:00:00.000Z'),
      amountMsat: 10_000n,
      buyerUserId: 'buyer-1',
      guestReceiptCode: null,
      gameId: 'game-1',
      game: { developerUserId: 'dev-missing' },
      entitlement: null,
    };

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
