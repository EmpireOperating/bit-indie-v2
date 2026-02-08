import { beforeEach, describe, expect, it, vi } from 'vitest';

describe('payoutWorker', () => {
  beforeEach(() => {
    vi.resetModules();
  });

  it('resolvePayoutProviderFromEnv uses mock mode when API key is absent', async () => {
    vi.doMock('../prisma.js', () => ({ prisma: {} }));
    vi.doMock('../payouts/opennode.js', () => ({ opennodeSendToLnAddress: vi.fn() }));

    const mod = await import('./payoutWorker.js');

    const provider = mod.resolvePayoutProviderFromEnv({
      OPENNODE_API_KEY: '   ',
      OPENNODE_BASE_URL: 'https://api.opennode.com',
      OPENNODE_WITHDRAWAL_CALLBACK_URL: 'https://cb.example.com',
    } as any);

    expect(provider.mode).toBe('mock');
    expect(provider.opennodeApiKey).toBe('');
  });

  it('runPayoutWorker in dry-run mode does not call payout provider', async () => {
    vi.doMock('../prisma.js', () => ({ prisma: {} }));
    vi.doMock('../payouts/opennode.js', () => ({ opennodeSendToLnAddress: vi.fn() }));

    const mod = await import('./payoutWorker.js');
    vi.spyOn(mod, 'acquireLock').mockResolvedValue({ lockPath: '/tmp/mock-lock', release: vi.fn(async () => undefined) });

    const prismaClient = {
      payout: {
        findMany: vi.fn(async () => [
          {
            id: 'p1',
            purchaseId: 'buy1',
            amountMsat: '1234',
            destinationLnAddress: 'dev@getalby.com',
            idempotencyKey: 'purchase:buy1',
          },
        ]),
      },
    };

    const sendToLnAddress = vi.fn(async () => ({ withdrawal: { id: 'w1', status: 'pending', fee: 1 } }));

    const result = await mod.runPayoutWorker(
      { limit: 10, dryRun: true },
      {
        prismaClient,
        sendToLnAddress,
        env: { OPENNODE_API_KEY: '' } as any,
      }
    );

    expect(result.scanned).toBe(1);
    expect(result.sent).toBe(0);
    expect(sendToLnAddress).not.toHaveBeenCalled();
  });

  it('runPayoutWorker writes PAYOUT_SUBMITTED exactly once when provider succeeds', async () => {
    vi.doMock('../prisma.js', () => ({ prisma: {} }));
    vi.doMock('../payouts/opennode.js', () => ({ opennodeSendToLnAddress: vi.fn() }));

    const mod = await import('./payoutWorker.js');
    vi.spyOn(mod, 'acquireLock').mockResolvedValue({ lockPath: '/tmp/mock-lock', release: vi.fn(async () => undefined) });

    const tx = {
      payout: {
        findUnique: vi.fn(async () => ({
          id: 'p1',
          purchaseId: 'buy1',
          amountMsat: '1234',
          destinationLnAddress: 'dev@getalby.com',
          idempotencyKey: 'purchase:buy1',
          status: 'SCHEDULED',
        })),
        update: vi.fn(async () => ({ id: 'p1', status: 'SUBMITTED' })),
      },
      ledgerEntry: {
        findFirst: vi.fn(async () => null),
        create: vi.fn(async () => ({ id: 'le1' })),
      },
    };

    const prismaClient = {
      payout: {
        findMany: vi.fn(async () => [
          {
            id: 'p1',
            purchaseId: 'buy1',
            amountMsat: '1234',
            destinationLnAddress: 'dev@getalby.com',
            idempotencyKey: 'purchase:buy1',
          },
        ]),
      },
      $transaction: vi.fn(async (fn: any) => fn(tx)),
    };

    const sendToLnAddress = vi.fn(async () => ({ withdrawal: { id: 'w1', status: 'pending', fee: 1 } }));

    const result = await mod.runPayoutWorker(
      { limit: 10, dryRun: false },
      {
        prismaClient,
        sendToLnAddress,
        env: { OPENNODE_API_KEY: 'key', OPENNODE_BASE_URL: '', OPENNODE_WITHDRAWAL_CALLBACK_URL: '' } as any,
      }
    );

    expect(result.sent).toBe(1);
    expect(sendToLnAddress).toHaveBeenCalledTimes(1);
    expect(tx.ledgerEntry.create).toHaveBeenCalledTimes(1);
    const ledgerArg = (tx.ledgerEntry.create as any).mock.calls[0][0];
    expect(ledgerArg.data.type).toBe('PAYOUT_SUBMITTED');
  });
});
