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

  it('resolveMaxAttemptsFromEnv falls back to safe default for invalid values', async () => {
    vi.doMock('../prisma.js', () => ({ prisma: {} }));
    vi.doMock('../payouts/opennode.js', () => ({ opennodeSendToLnAddress: vi.fn() }));

    const mod = await import('./payoutWorker.js');

    expect(mod.resolveMaxAttemptsFromEnv({} as any)).toBe(3);
    expect(mod.resolveMaxAttemptsFromEnv({ PAYOUT_MAX_ATTEMPTS: '0' } as any)).toBe(3);
    expect(mod.resolveMaxAttemptsFromEnv({ PAYOUT_MAX_ATTEMPTS: '-2' } as any)).toBe(3);
    expect(mod.resolveMaxAttemptsFromEnv({ PAYOUT_MAX_ATTEMPTS: '2.5' } as any)).toBe(3);
    expect(mod.resolveMaxAttemptsFromEnv({ PAYOUT_MAX_ATTEMPTS: '4' } as any)).toBe(4);
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
            attemptCount: 0,
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
    expect(result.providerMode).toBe('mock');
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
            attemptCount: 0,
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

  it('moves payouts to FAILED when retry budget is exhausted (mock-safe mode)', async () => {
    vi.doMock('../prisma.js', () => ({ prisma: {} }));
    vi.doMock('../payouts/opennode.js', () => ({ opennodeSendToLnAddress: vi.fn() }));

    const mod = await import('./payoutWorker.js');
    vi.spyOn(mod, 'acquireLock').mockResolvedValue({ lockPath: '/tmp/mock-lock', release: vi.fn(async () => undefined) });

    const prismaClient = {
      payout: {
        findMany: vi.fn(async () => [
          {
            id: 'p-fail',
            purchaseId: 'buy-fail',
            amountMsat: '2100',
            destinationLnAddress: 'dev@getalby.com',
            idempotencyKey: 'purchase:buy-fail',
            attemptCount: 3,
          },
        ]),
        update: vi.fn(async () => ({ id: 'p-fail', status: 'FAILED' })),
      },
    };

    const sendToLnAddress = vi.fn();

    const result = await mod.runPayoutWorker(
      { limit: 10, dryRun: false },
      {
        prismaClient,
        sendToLnAddress,
        env: { OPENNODE_API_KEY: '', PAYOUT_MAX_ATTEMPTS: '3' } as any,
      }
    );

    expect(result.skippedMaxAttempts).toBe(1);
    expect(result.sent).toBe(0);
    expect(prismaClient.payout.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'p-fail' },
        data: expect.objectContaining({ status: 'FAILED' }),
      })
    );
    expect(sendToLnAddress).not.toHaveBeenCalled();
  });

  it('marks payout as RETRYING when provider call fails in mock-safe mode', async () => {
    vi.doMock('../prisma.js', () => ({ prisma: {} }));
    vi.doMock('../payouts/opennode.js', () => ({ opennodeSendToLnAddress: vi.fn() }));

    const mod = await import('./payoutWorker.js');
    vi.spyOn(mod, 'acquireLock').mockResolvedValue({ lockPath: '/tmp/mock-lock', release: vi.fn(async () => undefined) });

    const prismaClient = {
      payout: {
        findMany: vi.fn(async () => [
          {
            id: 'p-retry',
            purchaseId: 'buy-retry',
            amountMsat: '2100',
            destinationLnAddress: 'dev@getalby.com',
            idempotencyKey: 'purchase:buy-retry',
            attemptCount: 1,
          },
        ]),
        update: vi.fn(async () => ({ id: 'p-retry', status: 'RETRYING' })),
      },
      $transaction: vi.fn(async () => {
        throw new Error('mock provider failure');
      }),
    };

    const sendToLnAddress = vi.fn(async () => {
      throw new Error('mock provider failure');
    });

    const result = await mod.runPayoutWorker(
      { limit: 10, dryRun: false },
      {
        prismaClient,
        sendToLnAddress,
        env: { OPENNODE_API_KEY: '' } as any,
      }
    );

    expect(result.errored).toBe(1);
    expect(prismaClient.payout.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'p-retry' },
        data: expect.objectContaining({ status: 'RETRYING' }),
      })
    );
  });

  it('ignores duplicate payout-submitted ledger creation races (P2002)', async () => {
    vi.doMock('../prisma.js', () => ({ prisma: {} }));
    vi.doMock('../payouts/opennode.js', () => ({ opennodeSendToLnAddress: vi.fn() }));

    const mod = await import('./payoutWorker.js');
    vi.spyOn(mod, 'acquireLock').mockResolvedValue({ lockPath: '/tmp/mock-lock', release: vi.fn(async () => undefined) });

    const tx = {
      payout: {
        findUnique: vi.fn(async () => ({
          id: 'p2',
          purchaseId: 'buy2',
          amountMsat: '999',
          destinationLnAddress: 'dev@getalby.com',
          idempotencyKey: 'purchase:buy2',
          status: 'SCHEDULED',
        })),
        update: vi.fn(async () => ({ id: 'p2', status: 'SUBMITTED' })),
      },
      ledgerEntry: {
        findFirst: vi.fn(async () => null),
        create: vi.fn(async () => {
          const err: any = new Error('duplicate');
          err.code = 'P2002';
          throw err;
        }),
      },
    };

    const prismaClient = {
      payout: {
        findMany: vi.fn(async () => [
          {
            id: 'p2',
            purchaseId: 'buy2',
            amountMsat: '999',
            destinationLnAddress: 'dev@getalby.com',
            idempotencyKey: 'purchase:buy2',
            attemptCount: 0,
          },
        ]),
      },
      $transaction: vi.fn(async (fn: any) => fn(tx)),
    };

    const sendToLnAddress = vi.fn(async () => ({ withdrawal: { id: 'w2', status: 'pending', fee: 0 } }));

    const result = await mod.runPayoutWorker(
      { limit: 10, dryRun: false },
      {
        prismaClient,
        sendToLnAddress,
        env: { OPENNODE_API_KEY: 'key' } as any,
      }
    );

    expect(result.sent).toBe(1);
    expect(result.errored).toBe(0);
    expect(tx.payout.update).toHaveBeenCalledTimes(1);
    expect(tx.ledgerEntry.create).toHaveBeenCalledTimes(1);
  });
});
